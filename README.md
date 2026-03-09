# 🌟 Lumina v2 — Real-Time Social Media App

Full-stack photo-sharing app with live updates, push notifications, and persistent auth.

## Tech Stack
| Layer | Local Dev | Production |
|---|---|---|
| Runtime | Node.js 18+ | Node.js 18+ |
| Framework | Express | Express |
| Real-time | Socket.io | Socket.io |
| Database | SQLite (file) | PostgreSQL |
| Auth | JWT + bcrypt | JWT + bcrypt |

---

## 🚀 Run Locally (30 seconds)

```bash
npm install
cp .env.example .env
node server.js
# Open http://localhost:3000
```

---

## 🔑 Demo Accounts (auto-seeded)

| Username | Password |
|---|---|
| `mila.rose` | `demo1234` |
| `j.santos` | `demo1234` |
| `kayla_w` | `demo1234` |

---

## ⚡ Real-Time Events (Socket.io)

| Event | Description |
|---|---|
| `online_count` | Live count of connected users |
| `new_post` | Someone created a post — appears instantly |
| `like_update` | Live like counts across all clients |
| `new_comment` | New comment appears live |
| `notification` | Personal like/follow/comment alert |

---

## 🌐 Deploy FREE to Render.com (Recommended)

1. Push to GitHub:
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOUR/lumina.git
git push -u origin main
```
2. Go to render.com → New → **Blueprint** → connect your repo
3. Render reads `render.yaml` → auto-creates web service + PostgreSQL
4. Click **Apply** — live in ~2 minutes at `https://lumina-app.onrender.com` ✅

## 🚂 Deploy to Railway

1. railway.app → New → GitHub repo
2. Add PostgreSQL plugin
3. Set env vars: `JWT_SECRET`, `DB_TYPE=postgres`, `DATABASE_URL` (from plugin)
4. Done ✅

## 🟣 Deploy to Heroku

```bash
heroku create lumina-app
heroku addons:create heroku-postgresql:mini
heroku config:set JWT_SECRET=<strong_secret> DB_TYPE=postgres NODE_ENV=production
git push heroku main
```

---

## 📁 Files

```
lumina/
├── server.js        # Express + Socket.io (all API routes)
├── db.js            # SQLite/PostgreSQL unified adapter
├── package.json
├── .env.example     # Copy to .env
├── render.yaml      # Render.com one-click deploy
├── Procfile         # Railway/Heroku deploy
├── .gitignore
└── public/
    └── index.html   # Full SPA: login + feed + real-time
```

---

## 🔒 Production Checklist
- [ ] Strong JWT_SECRET (64+ bytes)
- [ ] HTTPS (free on Render/Railway)
- [ ] NODE_ENV=production
- [ ] Set ALLOWED_ORIGINS to your domain
- [ ] PostgreSQL (not SQLite) for production
