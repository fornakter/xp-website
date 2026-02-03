const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'gamezone.db');
const db = new Database(dbPath);

// Włącz foreign keys
db.pragma('journal_mode = WAL');

// Tworzenie tabel
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        steam_id TEXT UNIQUE,
        steam_username TEXT,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_steam_id ON users(steam_id);
`);

// Funkcje pomocnicze
const userQueries = {
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findBySteamId: db.prepare('SELECT * FROM users WHERE steam_id = ?'),

    create: db.prepare(`
        INSERT INTO users (username, email, password_hash)
        VALUES (?, ?, ?)
    `),

    createWithSteam: db.prepare(`
        INSERT INTO users (username, email, steam_id, steam_username, avatar_url)
        VALUES (?, ?, ?, ?, ?)
    `),

    linkSteam: db.prepare(`
        UPDATE users SET steam_id = ?, steam_username = ?, avatar_url = ?
        WHERE id = ?
    `),

    updateLastLogin: db.prepare(`
        UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?
    `)
};

module.exports = { db, userQueries };
