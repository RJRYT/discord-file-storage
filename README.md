# Discord File Storage

Chunk files, upload each chunk to Discord as message attachments, store metadata in MongoDB, and re-fetch the CDN URLs at download time to reassemble the original file.

A Node.js/Express file-storage experiment that uses a Discord server (via a bot) as the backing store for file chunks. Each registered user gets an auto-created private Discord channel for their uploads. Includes auth, per-chunk upload status polling, CSRF protection, rate limiting, and a responsive EJS UI.

> ⚠️ This is a **learning / test project**. Do not use it for production or sensitive data. Discord is not a file host — files live in Discord messages and CDN URLs can change or be revoked.

---

## Features

- **User accounts** — register/login with email + password (bcrypt hashed), session-based auth
- **Auto Discord channel** — a private text channel is created per user on registration
- **Chunked uploads** — files are split into server-side chunks (default 25 MB) and each chunk is posted to Discord as a message attachment
- **Per-chunk tracking** — every chunk's Discord message/attachment IDs and SHA-256 are stored in MongoDB; upload progress is pollable per chunk
- **Download reassembly** — at download time, messages are re-fetched from Discord to obtain fresh CDN URLs, then chunks are streamed back in order
- **File management** — list, view details, download, and delete files (deletion also removes the Discord messages)
- **Profile** — view account info and set a default Discord channel ID
- **Security** — bcrypt passwords, express-session (MongoDB store), CSRF double-submit tokens, Helmet headers, rate limiting on auth/upload, input validation with express-validator
- **Responsive UI** — EJS templates with a dark, mobile-friendly layout

---

## Tech Stack

| Layer         | Packages                                                            |
| ------------- | ------------------------------------------------------------------- |
| Runtime       | Node.js, Express                                                    |
| Views         | EJS + express-ejs-layouts                                           |
| Database      | MongoDB + Mongoose (sessions via connect-mongo)                     |
| Auth          | bcryptjs, express-session                                           |
| HTTP client   | axios                                                               |
| File handling | multer, form-data                                                   |
| Security      | helmet, express-rate-limit, express-validator, CSRF (double-submit) |
| Dev           | nodemon, prettier                                                   |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/RJRYT/discord-file-storage
cd discord-file-storage
npm install
```

### 2. Configure environment

Copy the example file and fill in your values:

```bash
cp example.env .env
```

`.env` variables:

| Variable                    | Required | Description                                         | Default                                   |
| --------------------------- | -------- | --------------------------------------------------- | ----------------------------------------- |
| `PORT`                      | No       | Server port                                         | `3000`                                    |
| `MONGO_URI`                 | Yes      | MongoDB connection string                           | `mongodb://127.0.0.1:27017/discord-files` |
| `SESSION_SECRET`            | No       | Session signing secret                              | `dev-secret-change-in-production`         |
| `DISCORD_BOT_TOKEN`         | Yes      | Discord bot token                                   | —                                         |
| `DISCORD_GUILD_ID`          | Yes      | Discord server (guild) ID for auto channel creation | —                                         |
| `DISCORD_UPLOAD_CHANNEL_ID` | No       | Fallback channel ID when a user has no channel      | —                                         |
| `CHUNK_SIZE_BYTES`          | No       | Upload chunk size in bytes                          | `26214400` (25 MB)                        |
| `MAX_FILE_SIZE_BYTES`       | No       | Max upload file size in bytes                       | `10737418240` (10 GB)                     |
| `LOG_LEVEL`                 | No       | `ERROR` / `INFO` / `DEBUG`                          | `INFO`                                    |

### 3. Set up Discord

1. Create a bot at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy the bot token into `DISCORD_BOT_TOKEN`.
3. Invite the bot to your server with the `bot` and `applications.commands` scopes and these permissions:
   - `Manage Channels` (to auto-create user channels)
   - `Send Messages`, `Attach Files`, `Read Message History`, `Manage Messages` (upload/delete/fetch chunks)
4. Enable **Developer Mode** in Discord, right-click your server → **Copy ID**, and set it as `DISCORD_GUILD_ID`.
5. Optionally pick an existing channel for `DISCORD_UPLOAD_CHANNEL_ID`.

### 4. Run

```bash
# production
npm start

# development (auto-restart)
npm run dev
```

Visit `http://localhost:3000/auth/register` to create an account, then `http://localhost:3000/` to manage your files.

---

## Project Structure

```txt
discord-file-storage/
├── server.js            # Express app, session, security middleware, routes
├── package.json         # Dependencies and npm scripts
├── example.env          # Example environment variables (committed)
├── .env                 # Local secrets (gitignored)
├── models/
│   ├── User.js          # bcrypt auth model (username, email, password, discordChannelId)
│   └── File.js          # File metadata + per-chunk Discord message/attachment records
├── routes/
│   ├── auth.js          # register / login / logout (+ channel auto-creation)
│   └── files.js         # list / upload / detail / download / delete / status / profile
├── utils/
│   ├── discord.js       # Discord REST calls (post/delete/fetch message, create channel)
│   ├── chunker.js       # Streaming file chunker + SHA-256 helper
│   └── logger.js        # Color-coded request-scoped console logger with timers
├── middleware/
│   ├── auth.js          # requireAuth, requireGuest, loadUser
│   └── csrf.js          # Double-submit CSRF protection + token generator
├── views/               # EJS templates (layout, index, upload, file, login, register, profile)
├── public/
│   ├── styles.css       # Responsive dark UI
│   └── main.js          # Mobile nav, drag & drop, upload status polling
├── tmp/                 # Temporary upload staging (gitignored)
└── README.md
```

---

## How It Works

1. **Upload** — A file is streamed from disk into fixed-size chunks. Each chunk is hashed (SHA-256) and posted to the user's Discord channel as a message attachment via the Discord REST API (`POST /channels/{id}/messages`). A MongoDB `File` record stores each chunk's Discord channel/message/attachment IDs, size, hash, and status.
2. **Status polling** — The frontend polls `GET /files/:id/status`, which returns overall progress (`uploadedChunks / chunkCount`) plus per-chunk statuses.
3. **Download** — `GET /files/:id/download` re-fetches each chunk message from Discord (`GET /channels/{id}/messages/{id}`), grabs the current attachment CDN URL, streams the bytes back to the browser in chunk order, and sets `Content-Disposition` so the original file name is preserved.
4. **Delete** — `POST /files/:id/delete` removes each chunk's Discord message, then deletes the MongoDB record.

---

## Available Scripts

| Script                 | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `npm start`            | Start the production server (`node server.js`)         |
| `npm run dev`          | Start with nodemon for auto-restart during development |
| `npm run format`       | Format all files with Prettier                         |
| `npm run format:check` | Check Prettier formatting                              |

---

## Security Notes

- Sessions use `httpOnly`, `SameSite=Lax` cookies and are stored in MongoDB via `connect-mongo`.
- CSRF tokens are validated on all state-changing routes (double-submit via session + header/body).
- Auth and upload endpoints are rate-limited with `express-rate-limit`.
- Helmet sets secure response headers (CSP disabled for EJS inline styles — tighten before production).
- Passwords are hashed with bcrypt (10 rounds).

**This project is not suitable for production use.** Discord message attachments are not a reliable or private file store, CDN URLs can expire, and there is no encryption at rest. Treat uploaded files as public and temporary.

---

## License

ISC — see `package.json`. Test/learning project; use at your own risk.
