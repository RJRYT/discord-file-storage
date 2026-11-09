// utils/discord.js
const axios = require('axios');
const { response } = require('express');
const FormData = require('form-data');

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_UPLOAD_CHANNEL_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN) {
  console.warn('WARN: DISCORD_BOT_TOKEN not set in .env');
}

if (!GUILD_ID) {
  console.warn('WARN: DISCORD_GUILD_ID not set in .env (required for auto channel creation)');
}

async function postChunkToChannel(buffer, filename, index, channelId = CHANNEL_ID) {
  if (!channelId) {
    throw new Error('No Discord channel ID provided');
  }
  const form = new FormData();
  form.append('file', buffer, { filename });
  // small content helps traceability
  form.append('content', JSON.stringify({ chunkIndex: index }));

  const headers = {
    ...form.getHeaders(),
    Authorization: `Bot ${BOT_TOKEN}`,
    Accept: 'application/json',
  };

  // POST /channels/:channelId/messages
  const url = `${DISCORD_API}/channels/${channelId}/messages`;

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
        const retryAfter = resp.data?.retry_after ?? parseFloat(resp.headers['retry-after']) ?? 1;
        const waitMs = Math.ceil(retryAfter * 1000) + attempt * 200;
        console.warn(`Discord 429. waiting ${waitMs}ms (attempt ${attempt})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      // other non-OK
      throw new Error(`Discord upload failed: ${resp.status} ${JSON.stringify(resp.data)}`);
    } catch (err) {
      if (attempt >= 5) throw err;
      const backoff = 500 * attempt;
      console.warn('upload error, retrying after', backoff, err.message);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function deleteChunkFromChannel(channelId, messageId) {
  if (!channelId) {
    throw new Error('No Discord channel ID provided');
  }
  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}`;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const resp = await axios.delete(url, {
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          Accept: 'application/json',
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
        const retryAfter = resp.data?.retry_after ?? parseFloat(resp.headers['retry-after']) ?? 1;

        const waitMs = Math.ceil(retryAfter * 1000) + attempt * 200;
        console.warn(`Discord delete 429. waiting ${waitMs}ms (attempt ${attempt})`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      throw new Error(`Discord delete failed: ${resp.status} ${JSON.stringify(resp.data)}`);
    } catch (err) {
      if (attempt >= 5) throw err;
      const backoff = 500 * attempt;
      console.warn('delete error, retrying after', backoff, err.message);
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
  if (resp.status !== 200) throw new Error(`Failed to fetch message ${messageId}: ${resp.status}`);
  return resp.data;
}

async function createChannel(channelName) {
  if (!GUILD_ID) {
    throw new Error('No Discord guild ID configured. Set DISCORD_GUILD_ID in .env');
  }

  const url = `${DISCORD_API}/guilds/${GUILD_ID}/channels`;

  const resp = await axios.post(
    url,
    {
      name: channelName,
      type: 0, // text channel
    },
    {
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      validateStatus: (s) => s < 500,
    }
  );

  if (resp.status !== 201) {
    throw new Error(
      `Failed to create Discord channel: ${resp.status} ${JSON.stringify(resp.data)}`
    );
  }

  return resp.data.id;
}

module.exports = { postChunkToChannel, deleteChunkFromChannel, fetchMessage, createChannel };
