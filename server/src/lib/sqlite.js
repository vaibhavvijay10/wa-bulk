// Thin adapter that gives Node's built-in `node:sqlite` (Node 22.13+ / 24+)
// the small better-sqlite3 surface this app uses: prepare().get/all/run,
// exec, pragma, transaction, close. No native build step, no Visual Studio.
const { DatabaseSync } = require('node:sqlite');

class Statement {
  constructor(stmt) { this.stmt = stmt; }
  get(...args) { return this.stmt.get(...args); }
  all(...args) { return this.stmt.all(...args); }
  run(...args) {
    const r = this.stmt.run(...args);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
}

class Database {
  constructor(file) { this.db = new DatabaseSync(file); }
  prepare(sql) { return new Statement(this.db.prepare(sql)); }
  exec(sql) { this.db.exec(sql); }
  pragma(text) { this.db.exec('PRAGMA ' + text); }
  transaction(fn) {
    const db = this.db;
    return (...args) => {
      db.exec('BEGIN');
      try { const out = fn(...args); db.exec('COMMIT'); return out; }
      catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    };
  }
  close() { this.db.close(); }
}

module.exports = Database;
