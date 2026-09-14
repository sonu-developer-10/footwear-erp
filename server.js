const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database Connection Error:", err.message);
    else console.log("Connected to SQLite Database.");
});

// Create Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT,
        fixed_salary REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        date TEXT,
        status TEXT,
        location TEXT,
        timestamp TEXT,
        FOREIGN KEY(staff_id) REFERENCES staff(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS advances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        amount REAL,
        date TEXT,
        notes TEXT,
        FOREIGN KEY(staff_id) REFERENCES staff(id)
    )`);
});

// ==================== STAFF APIS ====================

// Get All Staff
app.get('/api/staff', (req, res) => {
    db.all("SELECT * FROM staff", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add Staff
app.post('/api/staff', (req, res) => {
    const { name, role, fixed_salary } = req.body;
    db.run(`INSERT INTO staff (name, role, fixed_salary) VALUES (?, ?, ?)`,
        [name, role, fixed_salary || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: "Staff added successfully" });
        }
    );
});

// Edit Staff
app.put('/api/staff/:id', (req, res) => {
    const { name, role, fixed_salary } = req.body;
    db.run(`UPDATE staff SET name = ?, role = ?, fixed_salary = ? WHERE id = ?`,
        [name, role, fixed_salary, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Staff updated successfully" });
        }
    );
});

// Delete Staff (and associated data)
app.delete('/api/staff/:id', (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
        db.run(`DELETE FROM attendance WHERE staff_id = ?`, [id]);
        db.run(`DELETE FROM advances WHERE staff_id = ?`, [id]);
        db.run(`DELETE FROM staff WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Staff and related records deleted successfully" });
        });
    });
});

// ==================== ATTENDANCE APIS ====================

// Get All Attendance
app.get('/api/attendance', (req, res) => {
    const sql = `
        SELECT attendance.*, staff.name as staff_name 
        FROM attendance 
        LEFT JOIN staff ON attendance.staff_id = staff.id 
        ORDER BY attendance.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Self Attendance (GPS Location mandatory)
app.post('/api/self-attendance', (req, res) => {
    const { staff_id, date, status, location } = req.body;
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: true });

    db.get("SELECT * FROM attendance WHERE staff_id = ? AND date = ?", [staff_id, date], (err, row) => {
        if (row) {
            return res.status(400).json({ error: "Aaj ki haazri pehle se darj hai!" });
        }

        db.run(`INSERT INTO attendance (staff_id, date, status, location, timestamp) VALUES (?, ?, ?, ?, ?)`,
            [staff_id, date, status, location, timestamp],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Haazri lag gayi hai! ✅" });
            }
        );
    });
});

// Edit Attendance
app.put('/api/attendance/:id', (req, res) => {
    const { status } = req.body;
    db.run(`UPDATE attendance SET status = ? WHERE id = ?`, [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Attendance updated successfully" });
    });
});

// Delete Attendance
app.delete('/api/attendance/:id', (req, res) => {
    db.run(`DELETE FROM attendance WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Attendance deleted successfully" });
    });
});

// ==================== ADVANCES APIS ====================

// Get All Advances
app.get('/api/advances', (req, res) => {
    const sql = `
        SELECT advances.*, staff.name as staff_name 
        FROM advances 
        LEFT JOIN staff ON advances.staff_id = staff.id 
        ORDER BY advances.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add Advance
app.post('/api/advances', (req, res) => {
    const { staff_id, amount, date, notes } = req.body;
    db.run(`INSERT INTO advances (staff_id, amount, date, notes) VALUES (?, ?, ?, ?)`,
        [staff_id, amount, date, notes],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: "Advance record saved" });
        }
    );
});

// Edit Advance
app.put('/api/advances/:id', (req, res) => {
    const { amount, notes } = req.body;
    db.run(`UPDATE advances SET amount = ?, notes = ? WHERE id = ?`, [amount, notes, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Advance updated successfully" });
    });
});

// Delete Advance
app.delete('/api/advances/:id', (req, res) => {
    db.run(`DELETE FROM advances WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Advance deleted successfully" });
    });
});


app.post('/api/wholesale-bill', (req, res) => {
    const { 
        bill_date, customer_id, customer_name, delivery_mode, vehicle_no, 
        items, total_amount, paid_cash, paid_online, discount_amount, paid_amount, remaining_due 
    } = req.body;

    db.run(
        `INSERT INTO bills (customer_id, customer_name, bill_date, total_amount, paid_cash, paid_online, discount_amount, paid_amount, remaining_due, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [customer_id, customer_name, bill_date, total_amount, paid_cash || 0, paid_online || 0, discount_amount || 0, paid_amount || 0, remaining_due],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const billId = this.lastID;

            // Save Bill Items
            const stmt = db.prepare(`INSERT INTO bill_items (bill_id, article_no, size, color, pairs, mrp, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            items.forEach(item => {
                stmt.run([billId, item.article_no, item.size_set, item.color, item.pairs, item.mrp, item.rate, item.amt]);
            });
            stmt.finalize();

            // Update Customer Ledger Balance
            db.run(`UPDATE customers SET previous_due = ? WHERE id = ?`, [remaining_due, customer_id]);

            res.json({ message: "Bill saved successfully", bill_id: billId });
        }
    );
});

// Dynamic Port Binding for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});