const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Aapke static HTML files ke liye

// SQLite Database Setup
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error("Database Connection Error:", err.message);
    } else {
        console.log("Connected to SQLite Database.");
    }
});

// Database Tables Initialization
db.serialize(() => {
    // 1. Customers Table
    db.run(`CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        city TEXT,
        previous_due REAL DEFAULT 0
    )`);

    // 2. Master Articles Table
    db.run(`CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_no TEXT NOT NULL,
        brand TEXT,
        color TEXT,
        size_type TEXT,
        mrp REAL DEFAULT 0,
        wholesale_rate REAL DEFAULT 0,
        pairs_per_box INTEGER DEFAULT 12
    )`);

    // 3. Purchase/Stock Entry Table
    db.run(`CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date TEXT,
        article_no TEXT,
        brand TEXT,
        size_set TEXT,
        color TEXT,
        cartons_count INTEGER DEFAULT 0,
        loose_pairs INTEGER DEFAULT 0,
        pairs_per_carton INTEGER DEFAULT 12,
        base_rate REAL DEFAULT 0
    )`);

    // 4. Wholesale Bills Table
    db.run(`CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_date TEXT,
        customer_id INTEGER,
        customer_name TEXT,
        delivery_mode TEXT,
        vehicle_no TEXT,
        total_amount REAL,
        paid_cash REAL DEFAULT 0,
        paid_online REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        remaining_due REAL DEFAULT 0,
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
        mrp REAL,
        rate REAL,
        amount REAL,
        FOREIGN KEY(bill_id) REFERENCES bills(id)
    )`);

    // 6. Staff Table
    db.run(`CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT,
        fixed_salary REAL DEFAULT 0
    )`);

    // 7. Attendance Table
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        date TEXT,
        status TEXT,
        timestamp TEXT,
        location TEXT,
        FOREIGN KEY(staff_id) REFERENCES staff(id)
    )`);

    // 8. Staff Advances Table
    db.run(`CREATE TABLE IF NOT EXISTS advances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        date TEXT,
        amount REAL,
        notes TEXT,
        FOREIGN KEY(staff_id) REFERENCES staff(id)
    )`);
});

// ==========================================================
// 1. PARTY / CUSTOMER APIS
// ==========================================================

// Add Customer / Party Profile (from admin.html)
app.post('/api/add-customer', (req, res) => {
    const { name, phone, city, previous_due } = req.body;
    if (!name) return res.status(400).json({ error: "Party Name zaroori hai!" });

    const query = `INSERT INTO customers (name, phone, city, previous_due) VALUES (?, ?, ?, ?)`;
    db.run(query, [name, phone || '', city || '', previous_due || 0], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Party Profile Successfully Saved!", id: this.lastID });
    });
});

// Fetch All Customers
app.get('/api/customers', (req, res) => {
    db.all(`SELECT * FROM customers ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Delete Customer
app.delete('/api/customers/:id', (req, res) => {
    db.run(`DELETE FROM customers WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Party delete ho gayi!" });
    });
});

// Customer Payment Receive (Jama)
app.post('/api/customer-payment', (req, res) => {
    const { id, amount_paid } = req.body;
    db.run(`UPDATE customers SET previous_due = previous_due - ? WHERE id = ?`, [amount_paid, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Payment successfully Jama ho gayi!" });
    });
});

// ==========================================================
// 2. MASTER ARTICLES APIS
// ==========================================================

// Add Master Article
app.post('/api/add-item', (req, res) => {
    const { article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box } = req.body;
    if (!article_no) return res.status(400).json({ error: "Article Code zaroori hai!" });

    const query = `INSERT INTO articles (article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [article_no, brand || '', color || '', size_type || '', mrp || 0, wholesale_rate || 0, pairs_per_box || 12], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Master Article Save Ho Gaya!", id: this.lastID });
    });
});

// Fetch All Master Articles
app.get('/api/articles', (req, res) => {
    db.all(`SELECT * FROM articles ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Delete Master Article
app.delete('/api/articles/:id', (req, res) => {
    db.run(`DELETE FROM articles WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Article delete ho gaya!" });
    });
});

// ==========================================================
// 3. STOCK INWARD & LIVE STOCK APIS
// ==========================================================

// Stock Inward Purchase Entry
app.post('/api/purchase', (req, res) => {
    const { entry_date, article_no, brand, size_set, color, cartons_count, loose_pairs, pairs_per_carton, base_rate } = req.body;
    if (!article_no) return res.status(400).json({ error: "Article Code zaroori hai!" });

    const query = `INSERT INTO purchases (entry_date, article_no, brand, size_set, color, cartons_count, loose_pairs, pairs_per_carton, base_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [entry_date, article_no, brand || '', size_set || '', color || '', cartons_count || 0, loose_pairs || 0, pairs_per_carton || 12, base_rate || 0], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Stock Inventory Mein Add Ho Gaya!", id: this.lastID });
    });
});

// Live Stock Breakdown Report
app.get('/api/stock', (req, res) => {
    const query = `
        SELECT 
            article_no, 
            brand, 
            size_set AS size, 
            color,
            SUM((cartons_count * pairs_per_carton) + loose_pairs) AS stock_pairs,
            (SUM(cartons_count) || ' Peti + ' || SUM(loose_pairs) || ' Loose') AS stock_summary
        FROM purchases 
        GROUP BY article_no, size_set, color
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==========================================================
// 4. WHOLESALE BILLING APIS
// ==========================================================

// Create Wholesale Bill
app.post('/api/wholesale-bill', (req, res) => {
    const { 
        bill_date, customer_id, customer_name, delivery_mode, vehicle_no, 
        items, total_amount, paid_cash, paid_online, discount_amount, paid_amount, remaining_due 
    } = req.body;

    if (!customer_id || !items || items.length === 0) {
        return res.status(400).json({ error: "Party aur kam se kam 1 item select karein!" });
    }

    db.run(
        `INSERT INTO bills (bill_date, customer_id, customer_name, delivery_mode, vehicle_no, total_amount, paid_cash, paid_online, discount_amount, paid_amount, remaining_due, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [bill_date, customer_id, customer_name, delivery_mode, vehicle_no, total_amount, paid_cash || 0, paid_online || 0, discount_amount || 0, paid_amount || 0, remaining_due],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            const billId = this.lastID;

            // Save Items
            const stmt = db.prepare(`INSERT INTO bill_items (bill_id, article_no, size, color, pairs, mrp, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            items.forEach(item => {
                stmt.run([billId, item.article_no, item.size_set, item.color, item.pairs, item.mrp, item.rate, item.amt]);
            });
            stmt.finalize();

            // Update Customer Ledger Balance
            db.run(`UPDATE customers SET previous_due = ? WHERE id = ?`, [remaining_due, customer_id]);

            res.json({ message: "Bill Successfully Save Ho Gaya!", bill_id: billId });
        }
    );
});

// Fetch Recent Bills
app.get('/api/bills', (req, res) => {
    db.all(`SELECT * FROM bills ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Fetch Bill Items by Bill ID
app.get('/api/bill-items/:bill_id', (req, res) => {
    db.all(`SELECT * FROM bill_items WHERE bill_id = ?`, [req.params.bill_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Cancel Bill
app.post('/api/cancel-bill', (req, res) => {
    const { bill_id } = req.body;
    
    db.get(`SELECT * FROM bills WHERE id = ?`, [bill_id], (err, bill) => {
        if (err || !bill) return res.status(400).json({ error: "Bill nahi mila" });
        if (bill.status === 'CANCELLED') return res.status(400).json({ error: "Bill pehle se cancelled hai" });

        db.run(`UPDATE bills SET status = 'CANCELLED' WHERE id = ?`, [bill_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // Rollback Customer Ledger Balance
            const adjustedDue = bill.remaining_due - bill.total_amount + bill.paid_amount;
            db.run(`UPDATE customers SET previous_due = previous_due - ? WHERE id = ?`, [bill.total_amount - bill.paid_amount, bill.customer_id]);

            res.json({ message: `Bill #${bill_id} successfully cancel ho gaya!` });
        });
    });
});

// ==========================================================
// 5. STAFF, ATTENDANCE & ADVANCE APIS
// ==========================================================

// Get All Staff
app.get('/api/staff', (req, res) => {
    db.all(`SELECT * FROM staff ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add Staff
app.post('/api/staff', (req, res) => {
    const { name, role, fixed_salary } = req.body;
    db.run(`INSERT INTO staff (name, role, fixed_salary) VALUES (?, ?, ?)`, [name, role || '', fixed_salary || 0], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Staff add ho gaya", id: this.lastID });
    });
});

// Update Staff
app.put('/api/staff/:id', (req, res) => {
    const { name, role, fixed_salary } = req.body;
    db.run(`UPDATE staff SET name = ?, role = ?, fixed_salary = ? WHERE id = ?`, [name, role, fixed_salary, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Staff update ho gaya" });
    });
});

// Delete Staff
app.delete('/api/staff/:id', (req, res) => {
    db.run(`DELETE FROM staff WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Staff record deleted" });
    });
});

// Get Attendance Reports
app.get('/api/attendance', (req, res) => {
    const query = `
        SELECT attendance.*, staff.name AS staff_name 
        FROM attendance 
        LEFT JOIN staff ON attendance.staff_id = staff.id 
        ORDER BY attendance.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Submit Self Attendance (from staff-app.html)
app.post('/api/self-attendance', (req, res) => {
    const { staff_id, date, status, location } = req.body;
    const time = new Date().toLocaleTimeString();

    db.run(`INSERT INTO attendance (staff_id, date, status, timestamp, location) VALUES (?, ?, ?, ?, ?)`, 
    [staff_id, date, status, time, location || ''], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Haazri (Attendance) Mark Ho Gayi! 📍" });
    });
});

// Update Attendance Status
app.put('/api/attendance/:id', (req, res) => {
    const { status } = req.body;
    db.run(`UPDATE attendance SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Attendance status updated" });
    });
});

// Delete Attendance Entry
app.delete('/api/attendance/:id', (req, res) => {
    db.run(`DELETE FROM attendance WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Attendance entry deleted" });
    });
});

// Get Staff Advances
app.get('/api/advances', (req, res) => {
    const query = `
        SELECT advances.*, staff.name AS staff_name 
        FROM advances 
        LEFT JOIN staff ON advances.staff_id = staff.id 
        ORDER BY advances.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Update Staff Advance Entry
app.put('/api/advances/:id', (req, res) => {
    const { amount, notes } = req.body;
    db.run(`UPDATE advances SET amount = ?, notes = ? WHERE id = ?`, [amount, notes, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Advance record updated" });
    });
});

// Delete Staff Advance Entry
app.delete('/api/advances/:id', (req, res) => {
    db.run(`DELETE FROM advances WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Advance record deleted" });
    });
});

// Server Listen
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});