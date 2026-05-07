import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = process.env.DATABASE_PATH || 'data.db';
const resolvedPath = isAbsolute(DB_PATH) ? DB_PATH : resolve(process.cwd(), DB_PATH);

// Make sure the parent directory exists (Docker volumes / hosting panels often
// expect us to manage our own paths under /app/data).
const parent = dirname(resolvedPath);
if (!existsSync(parent)) {
  mkdirSync(parent, { recursive: true });
}

export const db = new Database(resolvedPath);

// WAL mode = better concurrent-write performance for a chatty bot.
db.pragma('journal_mode = WAL');

db.prepare(
  `CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`
).run();
