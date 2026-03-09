# 🌟 Lumina — Social Media App

A full-stack photo-sharing social media app with authentication.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (single-page app)
- **Backend**: Node.js + Express
- **Database**: SQLite (via `better-sqlite3`) — zero config, file-based
- **Auth**: bcryptjs (password hashing) + JWT (session tokens)

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
node server.js
# or for auto-reload during development:
npx nodemon server.js
```

### 3. Open in browser
```
http://localhost:3000
```

---

## 📁 Project Structure
```
lumina/
├── server.js          # Express backend + all API routes
├── package.json
├── lumina.db          # SQLite database (auto-created on first run)
└── public/
    └── index.html     # Full frontend (login + feed, single file)
```

---

## 🔑 Demo Accounts
Three demo accounts are seeded automatically:

| Username     | Email              | Password    |
|--------------|--------------------|-------------|
| `mila.rose`  | mila@demo.com      | `demo1234`  |
| `j.santos`   | jorge@demo.com     | `demo1234`  |
| `kayla_w`    | kayla@demo.com     | `demo1234`  |

---

## 🛠 API Endpoints

### Auth
| Method | Route               | Description              |
|--------|---------------------|--------------------------|
| POST   | /api/auth/register  | Register new user        |
| POST   | /api/auth/login     | Login (returns JWT)      |
| GET    | /api/auth/me        | Get current user (auth)  |

### Posts
| Method | Route                  | Description           |
|--------|------------------------|-----------------------|
| GET    | /api/posts             | Get feed posts (auth) |
| POST   | /api/posts             | Create post (auth)    |
| POST   | /api/posts/:id/like    | Toggle like (auth)    |

### Users
| Method | Route                   | Description                |
|--------|-------------------------|----------------------------|
| GET    | /api/users/suggested    | Get suggested users (auth) |
| POST   | /api/users/:id/follow   | Toggle follow (auth)       |

---

## 🔒 Security Notes for Production
1. Set a strong `JWT_SECRET` via environment variable:
   ```bash
   JWT_SECRET=your_very_long_random_secret node server.js
   ```
2. Use HTTPS in production
3. Consider adding rate limiting (`express-rate-limit`)
4. For production, replace SQLite with PostgreSQL or MySQL
