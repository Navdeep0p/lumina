/**
 * Lumina — Real-Time Server v2
 * Stack : Express · Socket.io · better-sqlite3 (dev) · pg (prod) · JWT · bcrypt
 * Run   : node server.js
 */

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const path       = require('path');

const { db, initSchema, seedDemo } = require('./db');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'lumina_dev_secret_change_in_prod';

// ── CORS ──────────────────────────────────────────────────────
const origins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : '*';

app.use(cors({ origin: origins, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Socket.io ─────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: origins, methods: ['GET','POST'] }
});

// Track online users: userId => Set of socket IDs
const onlineUsers = new Map();

function broadcastOnlineCount() {
  io.emit('online_count', { count: onlineUsers.size });
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socket.id);
  broadcastOnlineCount();
  console.log(`🟢 ${socket.user.username} connected (${onlineUsers.size} online)`);

  socket.join(`user:${uid}`);

  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(uid);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) onlineUsers.delete(uid);
    }
    broadcastOnlineCount();
    console.log(`🔴 ${socket.user.username} disconnected (${onlineUsers.size} online)`);
  });
});

function notifyUser(userId, event, data) {
  io.to(`user:${userId}`).emit(event, data);
}

// ── Auth helpers ──────────────────────────────────────────────
function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '7d' });
}
function safeUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { first_name, last_name = '', email, username, password } = req.body;
    if (!first_name || !email || !username || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (username.length < 3)
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });

    const existing = await db.queryOne(
      'SELECT id FROM users WHERE LOWER(email)=$1 OR LOWER(username)=$2',
      [email.toLowerCase(), username.toLowerCase()]
    );
    if (existing) return res.status(409).json({ error: 'Email or username already taken.' });

    const hash = await bcrypt.hash(password, 12);
    const colors = ['#2d1845','#4e1a1a','#1a3a1a','#2e0a2e','#1a2e0a','#c8a96e'];
    const color  = colors[Math.floor(Math.random() * colors.length)];

    let user;
    if (db.type === 'postgres') {
      user = await db.queryOne(
        `INSERT INTO users (first_name,last_name,email,username,password,avatar_color)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [first_name, last_name, email.toLowerCase(), username.toLowerCase(), hash, color]
      );
    } else {
      const info = db._raw.prepare(
        `INSERT INTO users (first_name,last_name,email,username,password,avatar_color) VALUES (?,?,?,?,?,?)`
      ).run(first_name, last_name, email.toLowerCase(), username.toLowerCase(), hash, color);
      user = db._raw.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    }

    const token = makeToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password)
      return res.status(400).json({ error: 'Credentials required.' });

    const user = await db.queryOne(
      'SELECT * FROM users WHERE LOWER(email)=$1 OR LOWER(username)=$1',
      [identifier.toLowerCase()]
    );
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = makeToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await db.queryOne('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: safeUser(user) });
});

// ══════════════════════════════════════════════════════════════
//  POSTS
// ══════════════════════════════════════════════════════════════
app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*,
              u.username, u.first_name, u.last_name, u.avatar_color,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) AS user_liked,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC LIMIT 30`,
      [req.user.id]
    );
    res.json({ posts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load posts.' });
  }
});

app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const { caption = '', location = '', image_gradient = '' } = req.body;
    const grads = [
      'linear-gradient(160deg,#1a0a2e 0%,#2d1845 40%,#0d1a3a 100%)',
      'linear-gradient(160deg,#2e1a0a 0%,#4e2d1a 40%,#2e0a1a 100%)',
      'linear-gradient(160deg,#0a2e1a 0%,#1a4e2d 40%,#0a0a2e 100%)',
      'linear-gradient(160deg,#2e0a2e 0%,#4e1a4e 40%,#0a2e1a 100%)',
    ];
    const grad = image_gradient || grads[Math.floor(Math.random() * grads.length)];

    let post;
    if (db.type === 'postgres') {
      post = await db.queryOne(
        `WITH ins AS (INSERT INTO posts (user_id,caption,location,image_gradient) VALUES ($1,$2,$3,$4) RETURNING *)
         SELECT ins.*, u.username, u.first_name, u.avatar_color,
                0::bigint AS like_count, 0::bigint AS user_liked, 0::bigint AS comment_count
         FROM ins JOIN users u ON u.id = ins.user_id`,
        [req.user.id, caption, location, grad]
      );
    } else {
      const info = db._raw.prepare(
        `INSERT INTO posts (user_id,caption,location,image_gradient) VALUES (?,?,?,?)`
      ).run(req.user.id, caption, location, grad);
      post = db._raw.prepare(
        `SELECT p.*, u.username, u.first_name, u.avatar_color, 0 AS like_count, 0 AS user_liked, 0 AS comment_count
         FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id=?`
      ).get(info.lastInsertRowid);
    }

    // 🔴 REAL-TIME: broadcast new post to all connected clients
    io.emit('new_post', { post });

    res.status(201).json({ post });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create post.' });
  }
});

app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.user.id;

    const existing = await db.queryOne(
      'SELECT id FROM likes WHERE user_id=$1 AND post_id=$2', [userId, postId]
    );

    if (existing) {
      await db.query('DELETE FROM likes WHERE user_id=$1 AND post_id=$2', [userId, postId]);
    } else {
      await db.query(
        'INSERT INTO likes (user_id,post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, postId]
      );
      // Notify post owner
      const post = await db.queryOne('SELECT user_id FROM posts WHERE id=$1', [postId]);
      if (post && post.user_id !== userId) {
        const actor = await db.queryOne('SELECT username,avatar_color,first_name FROM users WHERE id=$1', [userId]);
        notifyUser(post.user_id, 'notification', {
          type: 'like', actor, post_id: postId,
          message: `@${actor.username} liked your post`,
        });
        await db.query(
          `INSERT INTO notifications (user_id,actor_id,type,post_id) VALUES ($1,$2,$3,$4)`,
          [post.user_id, userId, 'like', postId]
        );
      }
    }

    const row = await db.queryOne('SELECT COUNT(*) AS c FROM likes WHERE post_id=$1', [postId]);
    const likeCount = parseInt(row.c);

    // 🔴 REAL-TIME: broadcast live like count to everyone
    io.emit('like_update', { post_id: postId, like_count: likeCount, liked_by: userId });

    res.json({ liked: !existing, like_count: likeCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Like failed.' });
  }
});

// ── Comments ──────────────────────────────────────────────────
app.get('/api/posts/:id/comments', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, u.username, u.first_name, u.avatar_color
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 50`,
    [parseInt(req.params.id)]
  );
  res.json({ comments: rows });
});

app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });

    let comment;
    if (db.type === 'postgres') {
      comment = await db.queryOne(
        `WITH ins AS (INSERT INTO comments (user_id,post_id,body) VALUES ($1,$2,$3) RETURNING *)
         SELECT ins.*, u.username, u.first_name, u.avatar_color
         FROM ins JOIN users u ON u.id = ins.user_id`,
        [req.user.id, postId, body.trim()]
      );
    } else {
      const info = db._raw.prepare(
        `INSERT INTO comments (user_id,post_id,body) VALUES (?,?,?)`
      ).run(req.user.id, postId, body.trim());
      comment = db._raw.prepare(
        `SELECT c.*, u.username, u.first_name, u.avatar_color
         FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id=?`
      ).get(info.lastInsertRowid);
    }

    // 🔴 REAL-TIME: broadcast new comment
    io.emit('new_comment', { post_id: postId, comment });

    const post = await db.queryOne('SELECT user_id FROM posts WHERE id=$1', [postId]);
    if (post && post.user_id !== req.user.id) {
      notifyUser(post.user_id, 'notification', {
        type: 'comment',
        actor: { username: comment.username, avatar_color: comment.avatar_color },
        post_id: postId,
        message: `@${comment.username} commented: "${body.slice(0,40)}"`,
      });
    }

    res.status(201).json({ comment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Comment failed.' });
  }
});

// ── Notifications ─────────────────────────────────────────────
app.get('/api/notifications', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT n.*, u.username AS actor_username, u.avatar_color AS actor_color
     FROM notifications n JOIN users u ON u.id = n.actor_id
     WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 20`,
    [req.user.id]
  );
  res.json({ notifications: rows });
});

app.post('/api/notifications/read', requireAuth, async (req, res) => {
  await db.query('UPDATE notifications SET read=TRUE WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
});

// ── Users ─────────────────────────────────────────────────────
app.get('/api/users/suggested', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, username, first_name, last_name, avatar_color,
            (SELECT COUNT(*) FROM follows f WHERE f.following_id = users.id) AS follower_count,
            (SELECT COUNT(*) FROM follows f WHERE f.follower_id=$1 AND f.following_id=users.id) AS is_following
     FROM users WHERE id != $1 ORDER BY RANDOM() LIMIT 5`,
    [req.user.id]
  );
  res.json({ users: rows });
});

app.post('/api/users/:id/follow', requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself.' });

  const existing = await db.queryOne(
    'SELECT id FROM follows WHERE follower_id=$1 AND following_id=$2', [req.user.id, targetId]
  );
  if (existing) {
    await db.query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [req.user.id, targetId]);
  } else {
    await db.query(
      'INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.user.id, targetId]
    );
    const actor = await db.queryOne('SELECT username, avatar_color FROM users WHERE id=$1', [req.user.id]);
    notifyUser(targetId, 'notification', {
      type: 'follow', actor,
      message: `@${actor.username} started following you`,
    });
    await db.query(
      `INSERT INTO notifications (user_id,actor_id,type) VALUES ($1,$2,$3)`,
      [targetId, req.user.id, 'follow']
    );
  }

  // 🔴 REAL-TIME: broadcast follow change
  io.emit('follow_update', { follower_id: req.user.id, following_id: targetId, following: !existing });

  res.json({ following: !existing });
});

app.get('/api/online', requireAuth, (req, res) => {
  res.json({ count: onlineUsers.size, user_ids: [...onlineUsers.keys()] });
});

// Catch-all → SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  try {
    await initSchema(db);
    await seedDemo(db);
    server.listen(PORT, () => {
      console.log(`\n🌟 Lumina running  →  http://localhost:${PORT}`);
      console.log(`   DB : ${db.type === 'postgres' ? 'PostgreSQL' : 'SQLite (lumina.db)'}`);
      console.log(`   RT : Socket.io enabled`);
      console.log(`   Press Ctrl+C to stop\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();
