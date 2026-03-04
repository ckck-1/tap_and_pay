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
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../frontend')));

const TEAM_ID = "team-cr7";
let db;

/* =========================
   DATABASE SETUP
========================= */
(async () => {
    try {
        db = await open({
            filename: 'database.sqlite',
            driver: sqlite3.Database
        });

        await db.exec(`
            CREATE TABLE IF NOT EXISTS cards (
                uid TEXT PRIMARY KEY,
                holder_name TEXT NOT NULL,
                balance REAL DEFAULT 0,
                passcode TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT,
                type TEXT,
                amount REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("✓ Database Connected & Tables Verified");

        /* =========================
           DEFAULT USER CREATION
        ========================= */
        const defaultUID = "ck";
        const defaultPasscode = "1234";

        const existing = await db.get(
            "SELECT uid FROM cards WHERE uid = ?",
            [defaultUID]
        );

        if (!existing) {
            const hashed = await bcrypt.hash(defaultPasscode, 10);

            await db.run(
                "INSERT INTO cards (uid, holder_name, balance, passcode) VALUES (?, ?, ?, ?)",
                [defaultUID, "ck", 0, hashed]
            );

            await db.run(
                "INSERT INTO transactions (uid, type, amount) VALUES (?, ?, ?)",
                [defaultUID, "REGISTRATION", 0]
            );

            console.log("✅ Default user created → UID: ck | PIN: 1234");
        }

        server.listen(9223, "0.0.0.0", () => {
            console.log("🚀 Server running on port 9223");
        });

    } catch (err) {
        console.error("Database Setup Error:", err.message);
    }
})();

/* =========================
   MQTT SETUP
========================= */
const mqttClient = mqtt.connect("mqtt://broker.benax.rw");

mqttClient.on("connect", () => {
    mqttClient.subscribe(`rfid/${TEAM_ID}/card/status`);
    console.log("✓ MQTT Connected to broker.benax.rw");
});

mqttClient.on("message", async (topic, message) => {
    try {
        const data = JSON.parse(message.toString());

        if (data.status === "detected") {
            const card = await db.get(
                "SELECT uid, holder_name, balance FROM cards WHERE uid = ?",
                [data.uid]
            );

            io.emit("card_scanned", {
                uid: data.uid,
                exists: !!card,
                card
            });

        } else if (data.status === "removed") {
            io.emit("card_removed", { uid: data.uid });
        }

    } catch (err) {
        console.error("MQTT Parsing Error:", err.message);
    }
});

/* =========================
   API ROUTES
========================= */

/* -------- REGISTER -------- */
app.post("/api/register", async (req, res) => {
    const { uid, holder_name, amount, passcode } = req.body;

    try {
        const hashed = await bcrypt.hash(passcode, 10);

        await db.run("BEGIN TRANSACTION");

        await db.run(
            "INSERT INTO cards (uid, holder_name, balance, passcode) VALUES (?, ?, ?, ?)",
            [uid, holder_name, amount || 0, hashed]
        );

        await db.run(
            "INSERT INTO transactions (uid, type, amount) VALUES (?, ?, ?)",
            [uid, "REGISTRATION", amount || 0]
        );

        await db.run("COMMIT");

        res.json({ success: true });

    } catch (err) {
        await db.run("ROLLBACK");
        res.status(500).json({ error: err.message });
    }
});

/* -------- TOPUP -------- */
app.post("/api/topup", async (req, res) => {
    const { uid, amount } = req.body;

    try {
        await db.run("BEGIN TRANSACTION");

        await db.run(
            "UPDATE cards SET balance = balance + ? WHERE uid = ?",
            [amount, uid]
        );

        await db.run(
            "INSERT INTO transactions (uid, type, amount) VALUES (?, ?, ?)",
            [uid, "TOPUP", amount]
        );

        await db.run("COMMIT");

        const updated = await db.get(
            "SELECT balance FROM cards WHERE uid = ?",
            [uid]
        );

        io.emit("card_balance", {
            uid,
            new_balance: updated.balance
        });

        res.json({ success: true, newBalance: updated.balance });

    } catch (err) {
        await db.run("ROLLBACK");
        res.status(500).json({ error: err.message });
    }
});

/* -------- PAYMENT -------- */
app.post("/api/pay", async (req, res) => {
    const { uid, amount, passcode } = req.body;

    try {
        const card = await db.get(
            "SELECT * FROM cards WHERE uid = ?",
            [uid]
        );

        if (!card)
            return res.status(404).json({ error: "Card not found" });

        const match = await bcrypt.compare(passcode, card.passcode);
        if (!match)
            return res.status(401).json({ error: "Wrong PIN" });

        if (card.balance < amount)
            return res.status(400).json({ error: "Insufficient balance" });

        await db.run("BEGIN TRANSACTION");

        await db.run(
            "UPDATE cards SET balance = balance - ? WHERE uid = ?",
            [amount, uid]
        );

        await db.run(
            "INSERT INTO transactions (uid, type, amount) VALUES (?, ?, ?)",
            [uid, "PAYMENT", amount]
        );

        await db.run("COMMIT");

        const updated = await db.get(
            "SELECT balance FROM cards WHERE uid = ?",
            [uid]
        );

        io.emit("card_balance", {
            uid,
            new_balance: updated.balance
        });

        res.json({ success: true, newBalance: updated.balance });

    } catch (err) {
        await db.run("ROLLBACK");
        res.status(500).json({ error: err.message });
    }
});

/* -------- TERMINAL LOGIN (ADMIN) -------- */
app.post("/api/login", async (req, res) => {
    const { uid, passcode } = req.body;

    try {
        const user = await db.get(
            "SELECT * FROM cards WHERE uid = ?",
            [uid]
        );

        if (!user)
            return res.status(404).json({ error: "User not found" });

        const match = await bcrypt.compare(passcode, user.passcode);

        if (!match)
            return res.status(401).json({ error: "Invalid PIN" });

        res.json({
            success: true,
            message: "Terminal authenticated"
        });

    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});