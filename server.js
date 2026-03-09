/**
 * Lumina – Backend Server
 * Stack: Express · better-sqlite3 · bcryptjs · JWT
 * Run:   node server.js
 */

const express  = require('express');
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lumina_super_secret_change_in_production';

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database setup ────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'lumina.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT    NOT NULL,
    last_name  TEXT    NOT NULL DEFAULT '',
    email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT    NOT NULL,
    bio        TEXT    DEFAULT '',
    avatar_color TEXT  DEFAULT '#c8a96e',
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    caption    TEXT    DEFAULT '',
    location   TEXT    DEFAULT '',
    image_gradient TEXT DEFAULT '',
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS likes (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    UNIQUE(user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    UNIQUE(follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id),
    FOREIGN KEY (following_id) REFERENCES users(id)
  );
`);

// Seed demo posts if empty
const postCount = db.prepare('SELECT COUNT(*) as c FROM posts').get();
if (postCount.c === 0) {
  // Create demo users
  const demoUsers = [
    { first_name:'Mila', last_name:'Rose', email:'mila@demo.com', username:'mila.rose', password: bcrypt.hashSync('demo1234',10), avatar_color:'#2d1845' },
    { first_name:'Jorge', last_name:'Santos', email:'jorge@demo.com', username:'j.santos', password: bcrypt.hashSync('demo1234',10), avatar_color:'#4e1a1a' },
    { first_name:'Kayla', last_name:'W', email:'kayla@demo.com', username:'kayla_w', password: bcrypt.hashSync('demo1234',10), avatar_color:'#1a3a1a' },
  ];
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (first_name,last_name,email,username,password,avatar_color) VALUES (?,?,?,?,?,?)`);
  demoUsers.forEach(u => insertUser.run(u.first_name, u.last_name, u.email, u.username, u.password, u.avatar_color));

  const u1 = db.prepare('SELECT id FROM users WHERE username=?').get('mila.rose');
  const u2 = db.prepare('SELECT id FROM users WHERE username=?').get('j.santos');
  const u3 = db.prepare('SELECT id FROM users WHERE username=?').get('kayla_w');

  const insertPost = db.prepare(`INSERT INTO posts (user_id,caption,location,image_gradient) VALUES (?,?,?,?)`);
  if (u1) insertPost.run(u1.id, 'There\'s a quiet magic in the hour before dusk. #goldenHour #Kyoto #filmAesthetic', 'Kyoto, Japan', 'linear-gradient(160deg,#1a0a2e 0%,#2d1845 40%,#0d1a3a 100%)');
  if (u2) insertPost.run(u2.id, 'Lines, shadows, and the city breathing. #architecture #StreetPhoto #urbanLife', 'São Paulo, Brazil', 'linear-gradient(160deg,#2e1a0a 0%,#4e2d1a 40%,#2e0a1a 100%)');
  if (u3) insertPost.run(u3.id, 'Standing under the aurora, I felt impossibly small — and completely whole. #NorthernLights #Iceland', 'Iceland', 'linear-gradient(160deg,#0a2e1a 0%,#1a4e2d 40%,#0a0a2e 100%)');
}

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Helper ────────────────────────────────────────────────────
function safeUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { first_name, last_name = '', email, username, password } = req.body;

    if (!first_name || !email || !username || !password)
      return res.status(400).json({ error: 'All fields are required.' });

    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    if (username.length < 3)
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });

    const existing = db.prepare('SELECT id FROM users WHERE email=? OR username=?').get(email, username);
    if (existing) return res.status(409).json({ error: 'Email or username already taken.' });

    const hashed = await bcrypt.hash(password, 12);
    const colors = ['#2d1845','#4e1a1a','#1a3a1a','#2e0a2e','#1a2e0a','#c8a96e'];
    const avatar_color = colors[Math.floor(Math.random() * colors.length)];

    const result = db.prepare(
      `INSERT INTO users (first_name,last_name,email,username,password,avatar_color) VALUES (?,?,?,?,?,?)`
    ).run(first_name, last_name, email.toLowerCase(), username.toLowerCase(), hashed, avatar_color);

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password)
      return res.status(400).json({ error: 'Email/username and password are required.' });

    const user = db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(
      identifier.toLowerCase(), identifier.toLowerCase()
    );
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: safeUser(user) });
});

// ══════════════════════════════════════════════════════════════
//  POSTS ROUTES
// ══════════════════════════════════════════════════════════════

// GET /api/posts  – feed
app.get('/api/posts', requireAuth, (req, res) => {
  const posts = db.prepare(`
    SELECT p.*,
           u.username, u.first_name, u.last_name, u.avatar_color,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS user_liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT 20
  `).all(req.user.id);
  res.json({ posts });
});

// POST /api/posts  – create
app.post('/api/posts', requireAuth, (req, res) => {
  const { caption = '', location = '', image_gradient = '' } = req.body;
  const gradients = [
    'linear-gradient(160deg,#1a0a2e 0%,#2d1845 40%,#0d1a3a 100%)',
    'linear-gradient(160deg,#2e1a0a 0%,#4e2d1a 40%,#2e0a1a 100%)',
    'linear-gradient(160deg,#0a2e1a 0%,#1a4e2d 40%,#0a0a2e 100%)',
    'linear-gradient(160deg,#2e0a2e 0%,#4e1a4e 40%,#0a2e1a 100%)',
  ];
  const grad = image_gradient || gradients[Math.floor(Math.random() * gradients.length)];
  const result = db.prepare(
    `INSERT INTO posts (user_id,caption,location,image_gradient) VALUES (?,?,?,?)`
  ).run(req.user.id, caption, location, grad);

  const post = db.prepare(`
    SELECT p.*, u.username, u.first_name, u.avatar_color,
           0 AS like_count, 0 AS user_liked
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ post });
});

// POST /api/posts/:id/like
app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const postId = parseInt(req.params.id);
  const liked = db.prepare('SELECT id FROM likes WHERE user_id=? AND post_id=?').get(req.user.id, postId);
  if (liked) {
    db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.user.id, postId);
  } else {
    db.prepare('INSERT OR IGNORE INTO likes (user_id,post_id) VALUES (?,?)').run(req.user.id, postId);
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM likes WHERE post_id=?').get(postId).c;
  res.json({ liked: !liked, like_count: count });
});

// ══════════════════════════════════════════════════════════════
//  USERS ROUTES
// ══════════════════════════════════════════════════════════════

// GET /api/users/suggested
app.get('/api/users/suggested', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, first_name, last_name, avatar_color,
           (SELECT COUNT(*) FROM follows f WHERE f.following_id = users.id) AS follower_count
    FROM users
    WHERE id != ?
    ORDER BY RANDOM() LIMIT 5
  `).all(req.user.id);
  res.json({ users });
});

// POST /api/users/:id/follow
app.post('/api/users/:id/follow', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself.' });

  const following = db.prepare('SELECT id FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, targetId);
  if (following) {
    db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(req.user.id, targetId);
  } else {
    db.prepare('INSERT OR IGNORE INTO follows (follower_id,following_id) VALUES (?,?)').run(req.user.id, targetId);
  }
  res.json({ following: !following });
});

// ── Catch-all → serve frontend ────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌟 Lumina server running → http://localhost:${PORT}`);
  console.log(`   Database: lumina.db`);
  console.log(`   Press Ctrl+C to stop\n`);
});
