const express = require('express');
const mqtt = require('mqtt');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../frontend')));

const TEAM_ID = "team-cr7"; 
let db;

(async () => {
    try {
        db = await open({
            filename: 'database.sqlite',
            driver: sqlite3.Database
        });

        // We explicitly define the columns here
        await db.exec(`
            CREATE TABLE IF NOT EXISTS cards (
                uid TEXT PRIMARY KEY, 
                holder_name TEXT, 
                balance REAL DEFAULT 0, 
                passcode TEXT
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT,
                type TEXT, -- This was the missing column
                amount REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✓ Database Connected & Tables Verified");

        server.listen(8208, '0.0.0.0', () => {
            console.log(`🚀 Server: http://localhost:8208`);
        });
    } catch (err) {
        console.error("Database Setup Error:", err);
    }
})();

// 2. MQTT Logic
const mqttClient = mqtt.connect("mqtt://broker.benax.rw");
mqttClient.on('connect', () => {
    mqttClient.subscribe(`rfid/${TEAM_ID}/card/status`);
    console.log("✓ MQTT Connected to broker.benax.rw");
});

mqttClient.on('message', async (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        if (data.status === "detected") {
            const card = await db.get('SELECT * FROM cards WHERE uid = ?', [data.uid]);
            io.emit('card_scanned', { uid: data.uid, exists: !!card, card });
        }
        else if (data.status === "removed") {
            io.emit('card_removed', { uid: data.uid });
        }
    } catch (e) { console.error("MQTT Parsing Error:", e.message); }
});

// 3. API Routes (Fixed for Stability)
app.post('/api/register', async (req, res) => {
    const { uid, holder_name, amount, passcode } = req.body;
    
    try {
        const hashed = await bcrypt.hash(passcode, 10);
        
        // Use a simple transaction wrap
        await db.run('BEGIN TRANSACTION');

        await db.run(
            'INSERT INTO cards (uid, holder_name, balance, passcode) VALUES (?, ?, ?, ?)', 
            [uid, holder_name, amount || 0, hashed]
        );
        
        // This matches the CREATE TABLE columns exactly now
        await db.run(
            'INSERT INTO transactions (uid, type, amount) VALUES (?, ?, ?)', 
            [uid, 'REGISTRATION', amount || 0]
        );

        await db.run('COMMIT');
        console.log(`✅ Registered: ${holder_name}`);
        res.json({ success: true });
    } catch (err) {
        await db.run('ROLLBACK');
        console.error("Registration Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/topup', async (req, res) => {
    const { uid, amount } = req.body;
    try {
        await db.run('BEGIN TRANSACTION');
        
        // Update the user's money
        await db.run('UPDATE cards SET balance = balance + ? WHERE uid = ?', [amount, uid]);
        
        // Record the transaction - WE ADDED 'TOPUP' AS THE TYPE
        await db.run('INSERT INTO transactions (uid, type, amount) VALUES (?, ?, ?)', 
            [uid, 'TOPUP', amount]);
        
        await db.run('COMMIT');

        const updated = await db.get('SELECT balance FROM cards WHERE uid = ?', [uid]);
        io.emit('card_balance', { uid, new_balance: updated.balance });
        res.json({ success: true, newBalance: updated.balance });
    } catch (err) {
        await db.run('ROLLBACK');
        console.error("Topup Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pay', async (req, res) => {
    const { uid, amount, passcode } = req.body;
    try {
        const card = await db.get('SELECT * FROM cards WHERE uid = ?', [uid]);
        if (!card) return res.status(404).json({ error: "Card not found" });

        const match = await bcrypt.compare(passcode, card.passcode);
        if (!match) return res.status(401).json({ error: "Wrong PIN" });
        if (card.balance < amount) return res.status(400).json({ error: "Insufficient balance" });

        await db.run('BEGIN TRANSACTION');
        
        // Deduct the money
        await db.run('UPDATE cards SET balance = balance - ? WHERE uid = ?', [amount, uid]);
        
        // Record the transaction - WE ADDED 'PAYMENT' AS THE TYPE
        await db.run('INSERT INTO transactions (uid, type, amount) VALUES (?, ?, ?)', 
            [uid, 'PAYMENT', amount]);

        await db.run('COMMIT');

        const updated = await db.get('SELECT balance FROM cards WHERE uid = ?', [uid]);
        io.emit('card_balance', { uid, new_balance: updated.balance });
        res.json({ success: true, newBalance: updated.balance });
    } catch (err) {
        await db.run('ROLLBACK');
        console.error("Payment Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});