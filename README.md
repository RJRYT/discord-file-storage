Discord File Storage (test)
===========================

Features:
- Upload files via EJS UI
- Split into chunks and upload each chunk to a Discord channel using bot
- Store metadata in MongoDB
- On download: re-fetch messages to get fresh CDN URLs, stream chunks in order and stitch

Setup:
1. Clone
2. `npm install`
3. Create .env (see example)
4. Start: `npm start`
5. Visit http://localhost:3000/upload

Notes:
- CHUNK_SIZE_BYTES default = 25 MB
- Use a private Discord server/channel; do not use for production data
- This is a learning/test project
