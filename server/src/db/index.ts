import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../../wraith.sqlite')

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema(db)
  }
  return db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT    PRIMARY KEY,
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      meta         TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL,
      module_id  TEXT    NOT NULL,
      type       TEXT    NOT NULL,
      payload    TEXT    NOT NULL,
      timestamp  INTEGER NOT NULL,
      persist    INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_events_session
      ON events(session_id);

    CREATE INDEX IF NOT EXISTS idx_events_session_module
      ON events(session_id, module_id, type);

    CREATE TABLE IF NOT EXISTS init_data (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL,
      module_id  TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT    NOT NULL,
      UNIQUE(session_id, module_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_init_data_session
      ON init_data(session_id);

    CREATE TABLE IF NOT EXISTS commands (
      id           TEXT    PRIMARY KEY,
      session_id   TEXT    NOT NULL,
      module_id    TEXT    NOT NULL,
      command_id   TEXT    NOT NULL,
      params       TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      result       TEXT,
      error        TEXT,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_commands_session
      ON commands(session_id);
  `)
}
