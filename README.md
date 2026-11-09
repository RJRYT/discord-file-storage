Discord File Storage (test)
===========================

Features:
- User login / register with encrypted passwords
- Auto-creates a private Discord channel per user on registration
- Upload files via EJS UI
- Split into chunks and upload each chunk to your Discord channel using bot
- Upload status tracking (per-chunk status + overall progress polling)
- Store metadata in MongoDB
- On download: re-fetch messages to get fresh CDN URLs, stream chunks in order and stitch
- Responsive, mobile-friendly UI
- Security: sessions, CSRF protection, rate limiting, helmet headers, input validation

Setup:
1. Clone
2. `npm install`
3. Create `.env` with:
   - DISCORD_BOT_TOKEN
   - DISCORD_GUILD_ID (your Discord server ID, for auto channel creation)
   - DISCORD_UPLOAD_CHANNEL_ID (optional fallback channel)
   - MONGO_URI
   - SESSION_SECRET (change in production)
4. Start: `npm start`
5. Visit http://localhost:3000/auth/register to create an account

Notes:

- CHUNK_SIZE_BYTES default = 25 MB
- MAX_FILE_SIZE_BYTES default = 10 GB
- Use a private Discord server/channel; do not use for production data
- This is a learning/test project

Security:

- Sessions stored in MongoDB with httpOnly, SameSite cookies
- CSRF tokens on all state-changing routes
- Rate limiting on auth and upload endpoints
- Helmet security headers
- bcrypt password hashing
