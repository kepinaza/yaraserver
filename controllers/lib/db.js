const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../database.sqlite');
const db = new Database(dbPath);

//Create the video table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS video (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    code TEXT,
    path TEXT,
    thumbnail TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    duration REAL,
    size INTEGER,
    rating INTEGER DEFAULT 0,
    genre TEXT,
    series_code TEXT,
    series_title TEXT,
    is_deleted INTEGER DEFAULT 0
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS genre (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_code TEXT UNIQUE NOT NULL,
    series_title TEXT UNIQUE NOT NULL
  )
`).run();

module.exports = db;