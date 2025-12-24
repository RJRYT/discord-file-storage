// utils/discord.js
const axios = require("axios");
const { response } = require("express");
const FormData = require("form-data");

const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_UPLOAD_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.warn(
    "WARN: DISCORD_BOT_TOKEN or DISCORD_UPLOAD_CHANNEL_ID not set in .env"
  );
}

async function postChunkToChannel(buffer, filename, index) {
  const form = new FormData();
  form.append("file", buffer, { filename });
  // small content helps traceability
  form.append("content", JSON.stringify({ chunkIndex: index }));

  const headers = {
    ...form.getHeaders(),
    Authorization: `Bot ${BOT_TOKEN}`,
    Accept: "application/json",
  };

  // POST /channels/:channelId/messages
  const url = `${DISCORD_API}/channels/${CHANNEL_ID}/messages`;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const resp = await axios.post(url, form, {
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: (status) => true,
      });

      if (resp.status === 200 || resp.status === 201) {
        return resp.data;
      }

      if (resp.status === 429) {
        // Discord rate-limited
        const retryAfter =
          resp.data?.retry_after ??
          parseFloat(resp.headers["retry-after"]) ??
          1;
        const waitMs = Math.ceil(retryAfter * 1000) + attempt * 200;
        console.warn(`Discord 429. waiting ${waitMs}ms (attempt ${attempt})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      // other non-OK
      throw new Error(
        `Discord upload failed: ${resp.status} ${JSON.stringify(resp.data)}`
      );
    } catch (err) {
      if (attempt >= 5) throw err;
      const backoff = 500 * attempt;
      console.warn("upload error, retrying after", backoff, err.message);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function deleteChunkFromChannel(channelId, messageId) {
  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}`;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const resp = await axios.delete(url, {
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          Accept: "application/json",
        },
      });

      // Discord returns 204 No Content on success
      if (resp.status === 204) {
        return true;
      }

      if (resp.status === 404) {
        // already deleted or missing — treat as success
        return true;
      }

      if (resp.status === 429) {
        const retryAfter =
          resp.data?.retry_after ??
          parseFloat(resp.headers["retry-after"]) ??
          1;

        const waitMs = Math.ceil(retryAfter * 1000) + attempt * 200;
        console.warn(
          `Discord delete 429. waiting ${waitMs}ms (attempt ${attempt})`
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      throw new Error(
        `Discord delete failed: ${resp.status} ${JSON.stringify(resp.data)}`
      );
    } catch (err) {
      if (attempt >= 5) throw err;
      const backoff = 500 * attempt;
      console.warn("delete error, retrying after", backoff, err.message);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function fetchMessage(channelId, messageId) {
  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}`;
  const resp = await axios.get(url, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
    validateStatus: (s) => s < 500,
  });
  if (resp.status !== 200)
    throw new Error(`Failed to fetch message ${messageId}: ${resp.status}`);
  return resp.data;
}

module.exports = { postChunkToChannel, deleteChunkFromChannel, fetchMessage };
