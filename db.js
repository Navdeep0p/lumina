/**
 * db.js — unified database adapter
 * SQLite for local dev, PostgreSQL for production.
 * better-sqlite3 is optional — only needed locally.
 */

require('dotenv').config();
const path = require('path');

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

// ══════════════════════════════════════════════════════════════
//  SQLite adapter (local dev only)
// ══════════════════════════════════════════════════════════════
function makeSqliteAdapter() {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.error('❌  better-sqlite3 not available. Set DB_TYPE=postgres and provide DATABASE_URL.');
    process.exit(1);
  }

  const db = new Database(path.join(__dirname, 'lumina.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return {
    async query(sql, params = []) {
      let i = 0;
      const sqliteSql = sql.replace(/\$\d+/g, () => { i++; return '?'; });
      const stmt = db.prepare(sqliteSql);
      const isSelect = sqliteSql.trim().toUpperCase().startsWith('SELECT');
      if (isSelect) {
        return { rows: stmt.all(...params) };
      } else {
        const info = stmt.run(...params);
        return { rows: [{ id: info.lastInsertRowid }] };
      }
    },
    async queryOne(sql, params = []) {
      const { rows } = await this.query(sql, params);
      return rows[0] || null;
    },
    _raw: db,
    type: 'sqlite'
  };
}

// ══════════════════════════════════════════════════════════════
//  PostgreSQL adapter (production)
// ══════════════════════════════════════════════════════════════
function makePgAdapter() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('PG pool error:', err));

  return {
    async query(sql, params = []) {
      const client = await pool.connect();
      try {
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    },
    async queryOne(sql, params = []) {
      const { rows } = await this.query(sql, params);
      return rows[0] || null;
    },
    _pool: pool,
    type: 'postgres'
  };
}

// ══════════════════════════════════════════════════════════════
//  Schema
// ══════════════════════════════════════════════════════════════
async function initSchema(db) {
  const pg  = db.type === 'postgres';
  const AUTO = pg ? 'SERIAL' : 'INTEGER';
  const NOW  = pg ? 'NOW()' : "datetime('now')";

  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id           ${AUTO} PRIMARY KEY,
      first_name   TEXT NOT NULL,
      last_name    TEXT NOT NULL DEFAULT '',
      email        TEXT NOT NULL UNIQUE,
      username     TEXT NOT NULL UNIQUE,
      password     TEXT NOT NULL,
      bio          TEXT DEFAULT '',
      avatar_color TEXT DEFAULT '#c8a96e',
      created_at   TIMESTAMP DEFAULT (${NOW})
    );
    CREATE TABLE IF NOT EXISTS posts (
      id             ${AUTO} PRIMARY KEY,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caption        TEXT DEFAULT '',
      location       TEXT DEFAULT '',
      image_gradient TEXT DEFAULT '',
      created_at     TIMESTAMP DEFAULT (${NOW})
    );
    CREATE TABLE IF NOT EXISTS likes (
      id      ${AUTO} PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      UNIQUE(user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS follows (
      id           ${AUTO} PRIMARY KEY,
      follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(follower_id, following_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id         ${AUTO} PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT (${NOW})
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id         ${AUTO} PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      read       BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT (${NOW})
    );
  `;

  if (db.type === 'sqlite') {
    db._raw.exec(schema);
  } else {
    await db.query(schema);
  }
}

// ══════════════════════════════════════════════════════════════
//  Seed demo data
// ══════════════════════════════════════════════════════════════
async function seedDemo(db) {
  const bcrypt = require('bcryptjs');
  const existing = await db.queryOne('SELECT id FROM users WHERE username = $1', ['mila.rose']);
  if (existing) return;

  console.log('🌱 Seeding demo data…');
  const demos = [
    { fn:'Mila',  ln:'Rose',   email:'mila@demo.com',  un:'mila.rose', color:'#2d1845' },
    { fn:'Jorge', ln:'Santos', email:'jorge@demo.com', un:'j.santos',  color:'#4e1a1a' },
    { fn:'Kayla', ln:'W',      email:'kayla@demo.com', un:'kayla_w',   color:'#1a3a1a' },
  ];
  const gradients = [
    'linear-gradient(160deg,#1a0a2e 0%,#2d1845 40%,#0d1a3a 100%)',
    'linear-gradient(160deg,#2e1a0a 0%,#4e2d1a 40%,#2e0a1a 100%)',
    'linear-gradient(160deg,#0a2e1a 0%,#1a4e2d 40%,#0a0a2e 100%)',
  ];
  const captions = [
    "There's a quiet magic in the hour before dusk. #goldenHour #Kyoto #filmAesthetic",
    "Lines, shadows, and the city breathing. #architecture #StreetPhoto #urbanLife",
    "Standing under the aurora, I felt impossibly small — and completely whole. #NorthernLights #Iceland",
  ];
  const locations = ['Kyoto, Japan', 'São Paulo, Brazil', 'Iceland'];

  for (let i = 0; i < demos.length; i++) {
    const d = demos[i];
    const hash = await bcrypt.hash('demo1234', 10);
    let row;
    if (db.type === 'postgres') {
      row = await db.queryOne(
        `INSERT INTO users (first_name,last_name,email,username,password,avatar_color)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [d.fn, d.ln, d.email, d.un, hash, d.color]
      );
    } else {
      db._raw.prepare(
        `INSERT OR IGNORE INTO users (first_name,last_name,email,username,password,avatar_color) VALUES (?,?,?,?,?,?)`
      ).run(d.fn, d.ln, d.email, d.un, hash, d.color);
      row = db._raw.prepare('SELECT id FROM users WHERE username=?').get(d.un);
    }
    if (!row) continue;
    if (db.type === 'postgres') {
      await db.query(
        `INSERT INTO posts (user_id,caption,location,image_gradient) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [row.id, captions[i], locations[i], gradients[i]]
      );
    } else {
      db._raw.prepare(
        `INSERT OR IGNORE INTO posts (user_id,caption,location,image_gradient) VALUES (?,?,?,?)`
      ).run(row.id, captions[i], locations[i], gradients[i]);
    }
  }
  console.log('✅ Demo data seeded');
}

// ══════════════════════════════════════════════════════════════
//  Export
// ══════════════════════════════════════════════════════════════
const adapter = DB_TYPE === 'postgres' ? makePgAdapter() : makeSqliteAdapter();
module.exports = { db: adapter, initSchema, seedDemo };
