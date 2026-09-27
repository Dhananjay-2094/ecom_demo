const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./seed');

// Read the database location from configuration, using a local file by default.
const configuredPath = process.env.DATABASE_PATH || './data/store.sqlite';
const dbPath = path.resolve(process.cwd(), configuredPath);
// Create the data folder when it does not exist yet.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Open SQLite with a bounded wait for another writer to release its lock.
const db = new DatabaseSync(dbPath, { timeout: 5000 });
// Enable write-ahead logging, relationship checks, and a five-second lock wait.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');
// Wrap related writes in a transaction that locks for writing before reading mutable state.
db.transaction = (callback) => (...args) => {
  // Reserve the write transaction so another writer cannot change checkout state mid-operation.
  db.exec('BEGIN IMMEDIATE');
  try {
    // Run all transaction work and save it only after every step succeeds.
    const result = callback(...args);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    // Undo every write if any step fails, then pass the error to the API handler.
    db.exec('ROLLBACK');
    throw error;
  }
};
// Create any missing tables and indexes from the schema file.
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
// Insert stable starter products without duplicating them on later startups.
seed(db);

module.exports = db;
