const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// SQLite DB Setup
const db = new sqlite3.Database('./database.db', (err) => {
    if (!err) console.log("Connected to SQLite Database.");
});

// Database Tables Initialization
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, city TEXT, previous_due REAL DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, article_no TEXT, brand TEXT, color TEXT, size_type TEXT, mrp REAL DEFAULT 0, wholesale_rate REAL DEFAULT 0, pairs_per_box INTEGER DEFAULT 12)`);
    db.run(`CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_date TEXT, article_no TEXT, brand TEXT, size_set TEXT, color TEXT, cartons_count INTEGER DEFAULT 0, loose_pairs INTEGER DEFAULT 0, pairs_per_carton INTEGER DEFAULT 12, base_rate REAL DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS bills (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_date TEXT, customer_id INTEGER, customer_name TEXT, delivery_mode TEXT, vehicle_no TEXT, total_amount REAL, paid_amount REAL DEFAULT 0, remaining_due REAL DEFAULT 0, status TEXT DEFAULT 'ACTIVE')`);
    db.run(`CREATE TABLE IF NOT EXISTS bill_items (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER, article_no TEXT, size TEXT, color TEXT, mrp REAL, pairs INTEGER, rate REAL, amount REAL)`);
    db.run(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, fixed_salary REAL DEFAULT 0, joining_date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, date TEXT, status TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS advances (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, date TEXT, amount REAL, notes TEXT)`);
});

// Page Routing
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/billing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, 'public', 'staff.html')));

// --- API ENDPOINTS ---

// Customers/Parties
app.post('/api/add-customer', (req, res) => {
    const { name, phone, city, previous_due } = req.body;
    db.run(`INSERT INTO customers (name, phone, city, previous_due) VALUES (?, ?, ?, ?)`, [name, phone, city, previous_due || 0], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Party Saved Successfully!", id: this.lastID });
    });
});
app.get('/api/customers', (req, res) => {
    db.all(`SELECT * FROM customers ORDER BY id DESC`, [], (err, rows) => res.json(rows || []));
});

// Articles
app.post('/api/add-item', (req, res) => {
    const { article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box } = req.body;
    db.run(`INSERT INTO articles (article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [article_no, brand, color, size_type, mrp || 0, wholesale_rate || 0, pairs_per_box || 12], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Master Article Saved!" });
    });
});
app.get('/api/articles', (req, res) => {
    db.all(`SELECT * FROM articles ORDER BY id DESC`, [], (err, rows) => res.json(rows || []));
});

// Stock Inward & Live Breakdown
app.post('/api/purchase', (req, res) => {
    const { entry_date, article_no, brand, size_set, color, cartons_count, loose_pairs, pairs_per_carton, base_rate } = req.body;
    db.run(`INSERT INTO purchases (entry_date, article_no, brand, size_set, color, cartons_count, loose_pairs, pairs_per_carton, base_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entry_date, article_no, brand, size_set, color, cartons_count || 0, loose_pairs || 0, pairs_per_carton || 12, base_rate || 0], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Stock Added to Inventory!" });
    });
});
app.get('/api/stock', (req, res) => {
    const query = `
        SELECT article_no, brand, size_set AS size, color, 
               SUM((cartons_count * pairs_per_carton) + loose_pairs) AS stock_pairs,
               (SUM(cartons_count) || ' Peti + ' || SUM(loose_pairs) || ' Loose') AS stock_summary
        FROM purchases GROUP BY article_no, size_set, color`;
    db.all(query, [], (err, rows) => res.json(rows || []));
});

// Stock Inward History Fetch Endpoint
app.get('/api/stock-entries', (req, res) => {
    db.all(`SELECT * FROM purchases ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// Wholesale Billing
app.post('/api/wholesale-bill', (req, res) => {
    const { bill_date, customer_id, customer_name, delivery_mode, vehicle_no, items, total_amount, paid_amount, remaining_due } = req.body;
    db.run(`INSERT INTO bills (bill_date, customer_id, customer_name, delivery_mode, vehicle_no, total_amount, paid_amount, remaining_due) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [bill_date, customer_id, customer_name, delivery_mode, vehicle_no, total_amount, paid_amount || 0, remaining_due], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const billId = this.lastID;
        const stmt = db.prepare(`INSERT INTO bill_items (bill_id, article_no, size, color, mrp, pairs, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        items.forEach(i => stmt.run([billId, i.article_no, i.size, i.color, i.mrp, i.pairs, i.rate, i.amount]));
        stmt.finalize();
        
        // Update Party Ledger Balance
        db.run(`UPDATE customers SET previous_due = ? WHERE id = ?`, [remaining_due, customer_id]);
        res.json({ message: "Bill Generated Successfully!", bill_id: billId });
    });
});
app.get('/api/bills', (req, res) => {
    db.all(`SELECT * FROM bills ORDER BY id DESC`, [], (err, rows) => res.json(rows || []));
});

// Staff, Attendance & Advance
app.post('/api/staff', (req, res) => {
    const { name, phone, fixed_salary, joining_date } = req.body;
    db.run(`INSERT INTO staff (name, phone, fixed_salary, joining_date) VALUES (?, ?, ?, ?)`, [name, phone, fixed_salary, joining_date], function(err) {
        res.json({ message: "Staff Added Successfully!" });
    });
});
app.get('/api/staff', (req, res) => db.all(`SELECT * FROM staff ORDER BY id DESC`, [], (err, rows) => res.json(rows || [])));

app.post('/api/attendance', (req, res) => {
    const { staff_id, date, status } = req.body;
    db.run(`INSERT INTO attendance (staff_id, date, status) VALUES (?, ?, ?)`, [staff_id, date, status], function(err) {
        res.json({ message: "Haazri Marked!" });
    });
});

app.post('/api/advance', (req, res) => {
    const { staff_id, date, amount, notes } = req.body;
    db.run(`INSERT INTO advances (staff_id, date, amount, notes) VALUES (?, ?, ?, ?)`, [staff_id, date, amount, notes], function(err) {
        res.json({ message: "Advance Recorded!" });
    });
});


//Advance Version code

// --- UPDATE & DELETE ENDPOINTS ---

// Party Delete & Update
app.delete('/api/customers/:id', (req, res) => {
    db.run(`DELETE FROM customers WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Party Deleted" });
    });
});

app.put('/api/customers/:id', (req, res) => {
    const { name, phone, city, previous_due } = req.body;
    db.run(`UPDATE customers SET name = ?, phone = ?, city = ?, previous_due = ? WHERE id = ?`,
        [name, phone, city, previous_due, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Party Updated Successfully" });
    });
});

// Article Delete
app.delete('/api/articles/:id', (req, res) => {
    db.run(`DELETE FROM articles WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Article Deleted" });
    });
});

// Stock Inventory Adjustment/Edit
app.put('/api/stock/update', (req, res) => {
    const { article_no, size_set, color, cartons_count, loose_pairs } = req.body;
    db.run(`UPDATE purchases SET cartons_count = ?, loose_pairs = ? WHERE article_no = ? AND size_set = ? AND color = ?`,
        [cartons_count, loose_pairs, article_no, size_set, color], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Stock Updated" });
    });
});


// --- ADDITIONAL EDIT & DELETE ENDPOINTS ---

// Master Article Edit Endpoint
app.put('/api/articles/:id', (req, res) => {
    const { article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box } = req.body;
    db.run(`UPDATE articles SET article_no = ?, brand = ?, color = ?, size_type = ?, mrp = ?, wholesale_rate = ?, pairs_per_box = ? WHERE id = ?`,
        [article_no, brand, color, size_type, mrp, wholesale_rate, pairs_per_box, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Master Article Updated Successfully" });
    });
});

// Live Stock Delete Endpoint
app.delete('/api/stock/delete', (req, res) => {
    const { article_no, size_set, color } = req.body;
    db.run(`DELETE FROM purchases WHERE article_no = ? AND size_set = ? AND color = ?`,
        [article_no, size_set, color], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Stock Record Deleted" });
    });
});


//// Advance version code end

app.listen(PORT, () => console.log(`ERP Running: http://localhost:${PORT}`));