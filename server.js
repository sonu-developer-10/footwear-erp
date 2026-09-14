const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./wholesale_inventory.db', (err) => {
    if (err) console.error("Database Error:", err.message);
    else console.log("Wholesale ERP Database Connected.");
});

// Database Setup with Automatic Column Migration
// Database Setup with Safe Column Auto-Add
db.serialize(() => {
    // 1. Articles Master
    db.run(`CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_no TEXT UNIQUE,
        brand TEXT,
        color TEXT
    )`);

    // 2. Stock Table
    db.run(`CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_no TEXT,
        brand TEXT,
        size TEXT,
        color TEXT,
        stock_pairs INTEGER DEFAULT 0,
        landing_cost REAL DEFAULT 0,
        UNIQUE(article_no, size, color)
    )`);

    // 3. Customers Table
    db.run(`CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        city TEXT,
        previous_due REAL DEFAULT 0
    )`);

    // 4. Wholesale Bills Table
    db.run(`CREATE TABLE IF NOT EXISTS wholesale_bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        customer_name TEXT,
        bill_date TEXT,
        delivery_mode TEXT,
        vehicle_no TEXT,
        total_amount REAL,
        paid_amount REAL,
        remaining_due REAL,
        status TEXT DEFAULT 'ACTIVE'
    )`);

    // 5. Bill Items Table
    db.run(`CREATE TABLE IF NOT EXISTS bill_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER,
        article_no TEXT,
        size TEXT,
        color TEXT,
        pairs INTEGER,
        rate REAL,
        amount REAL
    )`);

    // Migration Helper (Missing columns safely add karne ke liye)
    const addColumn = (tableName, columnName, dataType) => {
        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${dataType}`, (err) => {
            if(!err) console.log(`Column '${columnName}' added to '${tableName}'`);
        });
    };

    // Auto-Add Missing Columns
    addColumn('articles', 'size_type', 'TEXT');
    addColumn('articles', 'mrp', 'REAL DEFAULT 0');
    addColumn('articles', 'wholesale_rate', 'REAL DEFAULT 0');
    addColumn('articles', 'pairs_per_box', 'INTEGER DEFAULT 12');
    
    addColumn('bill_items', 'mrp', 'REAL DEFAULT 0');

    // FIX FOR YOUR ERROR: status column missing in wholesale_bills
    addColumn('wholesale_bills', 'status', "TEXT DEFAULT 'ACTIVE'");
});

// 1. Add/Update Party
app.post('/api/add-customer', (req, res) => {
    const { name, phone, city, previous_due } = req.body;
    if(!name || !phone) return res.status(400).json({ error: "Name aur Phone zaroori hain!" });

    db.run(`INSERT INTO customers (name, phone, city, previous_due) VALUES (?, ?, ?, ?)
            ON CONFLICT(phone) DO UPDATE SET name = ?, city = ?, previous_due = ?`,
        [name, phone, city || '', previous_due || 0, name, city || '', previous_due || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Party Profile Saved!" });
        });
});

app.get('/api/customers', (req, res) => {
    db.all(`SELECT * FROM customers ORDER BY name ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/customer-payment', (req, res) => {
    const { id, amount_paid } = req.body;
    db.run(`UPDATE customers SET previous_due = previous_due - ? WHERE id = ?`, [amount_paid, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Payment Recorded!" });
    });
});

// 2. Add / Save Master Article (With MRP & Rates)
app.post('/api/add-item', (req, res) => {
    let { article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box } = req.body;
    if (!article_no) return res.status(400).json({ error: "Article Code zaroori hai!" });

    db.run(`INSERT INTO articles (article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(article_no) DO UPDATE SET 
            brand=excluded.brand, color=excluded.color, size_type=excluded.size_type, 
            mrp=excluded.mrp, wholesale_rate=excluded.wholesale_rate, pairs_per_box=excluded.pairs_per_box`,
        [article_no.trim(), brand || '', color || '', size_type || '6*9', parseFloat(mrp) || 0, parseFloat(wholesale_rate) || 0, parseInt(pairs_per_box) || 12],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Article Master Saved with Rates & MRP!" });
        });
});

// Get All Master Articles for Billing Dropdown
app.get('/api/articles', (req, res) => {
    db.all(`SELECT * FROM articles ORDER BY article_no ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Delete Article Master
app.delete('/api/articles/:id', (req, res) => {
    db.run(`DELETE FROM articles WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Article Master Deleted!" });
    });
});

// 3. Purchase / Stock Inward
app.post('/api/purchase', (req, res) => {
    let { entry_date, article_no, brand, size_set, color, cartons_count, loose_pairs, pairs_per_carton, base_rate } = req.body;

    if(!article_no || !size_set) return res.status(400).json({ error: "Article No aur Size Set zaroori hain!" });

    article_no = article_no.trim();
    color = color ? color.trim() : "Standard";
    
    const total_pairs = ((parseInt(cartons_count) || 0) * (parseInt(pairs_per_carton) || 12)) + (parseInt(loose_pairs) || 0);

    const sql = `INSERT INTO stock (article_no, brand, size, color, stock_pairs, landing_cost) 
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(article_no, size, color) 
                 DO UPDATE SET stock_pairs = stock_pairs + excluded.stock_pairs, landing_cost = excluded.landing_cost, brand = excluded.brand`;

    db.run(sql, [article_no, brand || '', size_set, color, total_pairs, parseFloat(base_rate) || 0], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Stock Added! Total: ${total_pairs} Pairs` });
    });
});

// 4. Wholesale Invoice Billing
app.post('/api/wholesale-bill', (req, res) => {
    const { bill_date, customer_id, customer_name, delivery_mode, vehicle_no, items, total_amount, paid_amount, remaining_due } = req.body;

    db.run(`INSERT INTO wholesale_bills (customer_id, customer_name, bill_date, delivery_mode, vehicle_no, total_amount, paid_amount, remaining_due, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [customer_id, customer_name, bill_date, delivery_mode, vehicle_no, total_amount, paid_amount, remaining_due],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const bill_id = this.lastID;

            items.forEach(item => {
                db.run(`INSERT INTO bill_items (bill_id, article_no, size, color, pairs, mrp, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [bill_id, item.article_no, item.size_set, item.color, item.pairs, item.mrp || 0, item.rate, item.amt]);

                db.run(`INSERT INTO stock (article_no, brand, size, color, stock_pairs, landing_cost) 
                         VALUES (?, '', ?, ?, ?, ?)
                         ON CONFLICT(article_no, size, color) 
                         DO UPDATE SET stock_pairs = stock_pairs - excluded.stock_pairs`,
                    [item.article_no, item.size_set, item.color, -item.pairs, item.rate]);
            });

            db.run(`UPDATE customers SET previous_due = ? WHERE id = ?`, [remaining_due, customer_id]);

            res.json({ message: "Wholesale Bill Saved Successfully!", bill_id });
        });
});

app.get('/api/bills', (req, res) => {
    db.all(`SELECT * FROM wholesale_bills ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get Items of a Specific Wholesale Bill
app.get('/api/bill-items/:bill_id', (req, res) => {
    db.all(`SELECT * FROM bill_items WHERE bill_id = ?`, [req.params.bill_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/cancel-bill', (req, res) => {
    const { bill_id } = req.body;

    db.get(`SELECT * FROM wholesale_bills WHERE id = ?`, [bill_id], (err, bill) => {
        if (err || !bill) return res.status(404).json({ error: "Bill nahi mila!" });
        if (bill.status === 'CANCELLED') return res.status(400).json({ error: "Bill pehle se Cancelled hai!" });

        db.all(`SELECT * FROM bill_items WHERE bill_id = ?`, [bill_id], (err, items) => {
            items.forEach(item => {
                db.run(`UPDATE stock SET stock_pairs = stock_pairs + ? WHERE article_no = ? AND size = ? AND color = ?`,
                    [item.pairs, item.article_no, item.size, item.color]);
            });

            const billNetEffect = bill.total_amount - bill.paid_amount;
            db.run(`UPDATE customers SET previous_due = previous_due - ? WHERE id = ?`, [billNetEffect, bill.customer_id]);

            db.run(`UPDATE wholesale_bills SET status = 'CANCELLED' WHERE id = ?`, [bill_id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: `Bill #${bill_id} Cancelled! Stock aur Udhaar Revert ho gaya.` });
            });
        });
            });
});

// 5. Get Live Stock
app.get('/api/stock', (req, res) => {
    const sql = `SELECT s.id, s.article_no, s.brand, s.size, s.color, s.stock_pairs, a.pairs_per_box 
                 FROM stock s LEFT JOIN articles a ON s.article_no = a.article_no`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const formatted = rows.map(item => {
            const boxSize = item.pairs_per_box || 12;
            const cartons = Math.floor(item.stock_pairs / boxSize);
            const loose = item.stock_pairs % boxSize;
            let status = "NORMAL";
            if(item.stock_pairs < 0) status = "SHORTAGE";
            
            return { 
                ...item, 
                stock_summary: `${cartons} Cartons + ${loose} Loose Prs`,
                status: status
            };
        });
        res.json(formatted);
    });
});

app.delete('/api/customers/:id', (req, res) => {
    db.run(`DELETE FROM customers WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Customer Deleted!" });
    });
});

// Jab koi /wholesale-bill.html par jaye, toh usse index.html serve karein
app.get('/wholesale-bill.html', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});


// Staff Billing URL (Direct access)
app.get('/bill', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Admin Link (Sirf aapke liye)
app.get('/admin-secret-access', (req, res) => {
    res.sendFile(__dirname + '/public/admin.html');
});


///////////////////////////////////////////////////////////////////////

// Database Tables Create Karein (Agar nahi bana hai)
db.serialize(() => {
    // Staff Table
    db.run(`CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        monthly_salary REAL DEFAULT 0,
        joining_date TEXT
    )`);

    // Attendance Table
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        date TEXT,
        status TEXT,
        FOREIGN KEY(staff_id) REFERENCES staff(id)
    )`);

    // Staff Advance/Payments Table
    db.run(`CREATE TABLE IF NOT EXISTS staff_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        date TEXT,
        amount REAL,
        notes TEXT,
        FOREIGN KEY(staff_id) REFERENCES staff(id)
    )`);
});

// APIs FOR STAFF MANAGEMENT
app.get('/api/staff', (req, res) => {
    db.all("SELECT * FROM staff", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/staff', (req, res) => {
    const { name, phone, monthly_salary, joining_date } = req.body;
    db.run(`INSERT INTO staff (name, phone, monthly_salary, joining_date) VALUES (?, ?, ?, ?)`,
        [name, phone, monthly_salary, joining_date],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: "Staff Added Successfully!" });
        });
});

// Mark Attendance API
app.post('/api/attendance', (req, res) => {
    const { staff_id, date, status } = req.body;
    db.run(`INSERT INTO attendance (staff_id, date, status) VALUES (?, ?, ?)`,
        [staff_id, date, status],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Attendance Marked!" });
        });
});

// Add Advance/Payment API
app.post('/api/staff-advance', (req, res) => {
    const { staff_id, date, amount, notes } = req.body;
    db.run(`INSERT INTO staff_payments (staff_id, date, amount, notes) VALUES (?, ?, ?, ?)`,
        [staff_id, date, amount, notes],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Advance Payment Recorded!" });
        });
});

// Staff Monthly Hisab Report API
app.get('/api/staff-report/:staff_id/:month', (req, res) => {
    const { staff_id, month } = req.params; // month format: YYYY-MM
    
    db.get("SELECT * FROM staff WHERE id = ?", [staff_id], (err, staff) => {
        if (!staff) return res.status(404).json({ error: "Staff not found" });

        db.all("SELECT status FROM attendance WHERE staff_id = ? AND date LIKE ?", [staff_id, `${month}%`], (err, attRows) => {
            db.all("SELECT * FROM staff_payments WHERE staff_id = ? AND date LIKE ?", [staff_id, `${month}%`], (err, payRows) => {
                
                let presentDays = 0;
                let halfDays = 0;
                let absentDays = 0;

                attRows.forEach(a => {
                    if(a.status === 'Present') presentDays++;
                    else if(a.status === 'Half-Day') halfDays++;
                    else if(a.status === 'Absent') absentDays++;
                });

                const totalWorkingDays = presentDays + (halfDays * 0.5);
                const perDaySalary = staff.monthly_salary / 30; // 30 Days Month Standard
                const earnedSalary = Math.round(totalWorkingDays * perDaySalary);

                let totalAdvanceTaken = 0;
                payRows.forEach(p => totalAdvanceTaken += p.amount);

                const netPayable = earnedSalary - totalAdvanceTaken;

                res.json({
                    staff_name: staff.name,
                    monthly_salary: staff.monthly_salary,
                    present_days: presentDays,
                    half_days: halfDays,
                    absent_days: absentDays,
                    total_working_days: totalWorkingDays,
                    earned_salary: earnedSalary,
                    total_advance: totalAdvanceTaken,
                    net_payable: netPayable,
                    advances_list: payRows
                });
            });
        });
    });
});


//////////////////////////////////////////////////////////////////////////////////////////

// Staff Mobile Shortcut Route
app.get('/staff-app', (req, res) => {
    res.sendFile(__dirname + '/public/staff-app.html');
});

// Self-Attendance API for Staff
app.post('/api/self-attendance', (req, res) => {
    const { staff_id, date, status, location } = req.body;
    
    // Check if already marked for today
    db.get("SELECT * FROM attendance WHERE staff_id = ? AND date = ?", [staff_id, date], (err, row) => {
        if (row) {
            return res.status(400).json({ error: "Aaj ki haazri pehle se darj hai!" });
        }
        
        db.run(`INSERT INTO attendance (staff_id, date, status) VALUES (?, ?, ?)`,
            [staff_id, date, status],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Aapki Haazri Lag Gayi Hai! ✅" });
            });
    });
});


// Database Clean/Reset API Route
app.get('/api/reset-database-danger-zone', (req, res) => {
    db.serialize(() => {
        db.run(`DROP TABLE IF EXISTS attendance`);
        db.run(`DROP TABLE IF EXISTS advances`);
        db.run(`DROP TABLE IF EXISTS staff`);
        
        // Dynamic re-creation of fresh tables
        db.run(`CREATE TABLE staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, fixed_salary REAL)`);
        db.run(`CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, date TEXT, status TEXT, location TEXT, timestamp TEXT)`);
        db.run(`CREATE TABLE advances (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, amount REAL, date TEXT, notes TEXT)`);
    });
    res.send("<h1>Database Reset Successful! Sara dummy data delete ho gaya hai.</h1>");
});


// app.listen(3000, () => console.log(`Wholesale ERP running on http://localhost:3000`));

app.listen(3000, '0.0.0.0', () => {
    console.log("Server running on http://0.0.0.0:3000");
});