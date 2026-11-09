const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { produceChunks, sha256 } = require('../utils/chunker');
const { postChunkToChannel, deleteChunkFromChannel, fetchMessage } = require('../utils/discord');
const FileModel = require('../models/File');
const User = require('../models/User');
const axios = require('axios');
const logger = require('../utils/logger');
const { requireAuth, loadUser } = require('../middleware/auth');
const { csrfMiddleware, generateCsrfToken } = require('../middleware/csrf');
const { body, validationResult } = require('express-validator');

router.use(loadUser);

// TMP upload folder
const TMP_DIR = path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const upload = multer({ dest: TMP_DIR });

// config
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_BYTES || '26214400', 10); // default 25MB
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_BYTES || '10737418240', 10); // default 10GB

// GET /files - list user's files
router.get('/', requireAuth, async (req, res) => {
  const files = await FileModel.find({ userId: req.session.userId }).sort({ createdAt: -1 }).lean();
  res.render('index', {
    files,
    user: req.user,
    csrfToken: generateCsrfToken(req),
  });
});

// GET /files/upload - upload form
router.get('/upload', requireAuth, (req, res) => {
  res.render('upload', {
    user: req.user,
    csrfToken: generateCsrfToken(req),
    error: null,
  });
});

// POST /files/upload - handle upload
router.post(
  '/upload',
  requireAuth,
  upload.single('file'),
  csrfMiddleware,
  async (req, res) => {
  if (!req.file) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }
    return res.render('upload', {
      user: req.user,
      csrfToken: generateCsrfToken(req),
      error: 'No file uploaded',
    });
  }

  const tmpPath = req.file.path;
  const originalName = req.file.originalname;
  const size = req.file.size;
  const mimeType = req.file.mimetype;

  // file size limit
  if (size > MAX_FILE_SIZE) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {}
    const msg = `File too large. Max size is ${(MAX_FILE_SIZE / (1024 * 1024 * 1024)).toFixed(2)} GB.`;
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ ok: false, error: msg });
    }
    return res.render('upload', {
      user: req.user,
      channelId: req.body.channelId || '',
      csrfToken: generateCsrfToken(req),
      error: msg,
    });
  }

  // use user's auto-created Discord channel
  const channelId = req.user?.discordChannelId || process.env.DISCORD_UPLOAD_CHANNEL_ID || '';
  if (!channelId) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {}
    const msg = 'No Discord channel configured. Please contact support.';
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ ok: false, error: msg });
    }
    return res.render('upload', {
      user: req.user,
      csrfToken: generateCsrfToken(req),
      error: msg,
    });
  }

  const chunkCount = Math.ceil(size / CHUNK_SIZE);

  const fileDoc = await FileModel.create({
    originalName,
    size,
    mimeType,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    chunks: [],
    status: 'queued',
    uploadStatus: 'queued',
    uploadedChunks: 0,
    userId: req.session.userId,
    channelId,
  });

  const uploadTimer = logger.startTimer();
  logger.upload(
    'File upload started',
    {
      filename: originalName,
      size,
      mimeType,
      chunkCount,
      channelId,
      userId: req.session.userId,
    },
    req.requestId
  );

  try {
    await produceChunks(tmpPath, CHUNK_SIZE, async (buffer, index) => {
      const chunkHash = sha256(buffer);
      const chunkFilename = `${fileDoc._id}_chunk_${index}`;

      logger.discord(
        'Uploading chunk to Discord',
        {
          fileId: fileDoc._id,
          index,
          userId: req.session.userId,
        },
        req.requestId
      );

      let message;
      try {
        message = await postChunkToChannel(buffer, chunkFilename, index, channelId);
      } catch (err) {
        // mark chunk failed
        await FileModel.findByIdAndUpdate(fileDoc._id, {
          $push: {
            chunks: {
              index,
              size: buffer.length,
              channelId,
              messageId: '',
              attachmentId: '',
              sha256: chunkHash,
              uploadedAt: new Date(),
              status: 'failed',
            },
          },
        });
        throw err;
      }

      const attachment =
        message.attachments && message.attachments[0] ? message.attachments[0] : null;

      await FileModel.findByIdAndUpdate(fileDoc._id, {
        $push: {
          chunks: {
            index,
            size: buffer.length,
            channelId: message.channel_id || channelId,
            messageId: message.id,
            attachmentId: attachment?.id,
            sha256: chunkHash,
            uploadedAt: new Date(),
            status: 'uploaded',
          },
        },
        $inc: { uploadedChunks: 1 },
        $set: { uploadStatus: 'uploading', status: 'uploading' },
      });

      // gentle pause between uploads
      await new Promise((r) => setTimeout(r, 250));
    });

    // mark complete
    await FileModel.findByIdAndUpdate(fileDoc._id, {
      status: 'completed',
      uploadStatus: 'completed',
    });
    logger.upload(
      'File upload completed',
      {
        fileId: fileDoc._id,
        originalName,
        totalChunks: chunkCount,
        totalTime: `${logger.endTimerMs(uploadTimer)} ms`,
        userId: req.session.userId,
      },
      req.requestId
    );

    // delete tmp
    fs.unlink(tmpPath, () => {});

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ ok: true, fileId: fileDoc._id });
    }
    return res.redirect(`/files/${fileDoc._id}`);
  } catch (err) {
    console.error('Upload failed', err);
    await FileModel.findByIdAndUpdate(fileDoc._id, {
      status: 'failed',
      uploadStatus: 'failed',
    });
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {}
    logger.error(
      'File upload failed',
      {
        fileId: fileDoc._id,
        error: err.message,
        userId: req.session.userId,
      },
      req.requestId
    );
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ ok: false, error: err.message });
    }
    return res.status(500).render('upload', {
      user: req.user,
      channelId,
      csrfToken: generateCsrfToken(req),
      error: 'Upload failed: ' + err.message,
    });
  }
});

// GET /files/:id - file detail
router.get('/:id', requireAuth, async (req, res) => {
  const file = await FileModel.findOne({
    _id: req.params.id,
    userId: req.session.userId,
  }).lean();
  if (!file) return res.status(404).send('Not found');
  res.render('file', {
    file,
    user: req.user,
    csrfToken: generateCsrfToken(req),
  });
});

// GET /files/:id/status - upload status polling
router.get('/:id/status', requireAuth, async (req, res) => {
  const file = await FileModel.findOne({
    _id: req.params.id,
    userId: req.session.userId,
  })
    .select('uploadStatus status uploadedChunks chunkCount chunks')
    .lean();
  if (!file) return res.status(404).json({ ok: false, error: 'Not found' });

  const total = file.chunkCount || 0;
  const uploaded = file.uploadedChunks || 0;
  const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;

  return res.json({
    ok: true,
    uploadStatus: file.uploadStatus,
    status: file.status,
    uploadedChunks: uploaded,
    totalChunks: total,
    progressPercent: pct,
    chunks: (file.chunks || []).map((c) => ({
      index: c.index,
      status: c.status,
      size: c.size,
    })),
  });
});

// GET /files/:id/download - stream assembled file
router.get('/:id/download', requireAuth, async (req, res) => {
  const file = await FileModel.findOne({
    _id: req.params.id,
    userId: req.session.userId,
  }).lean();
  if (!file || file.uploadStatus !== 'completed') return res.status(404).send('File not available');

  logger.download(
    'Download requested',
    {
      fileId: file._id,
      filename: file.originalName,
      userId: req.session.userId,
    },
    req.requestId
  );

  res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');

  const chunks = (file.chunks || []).sort((a, b) => a.index - b.index);

  try {
    for (const ch of chunks) {
      if (ch.status !== 'uploaded' || !ch.messageId) {
        throw new Error(`Chunk ${ch.index} is not available for download`);
      }

      logger.download(
        'Fetching chunk message',
        {
          fileId: file._id,
          chunkIndex: ch.index,
          messageId: ch.messageId,
        },
        req.requestId
      );

      const message = await fetchMessage(ch.channelId || file.channelId, ch.messageId);
      const attachment =
        message.attachments && message.attachments[0] ? message.attachments[0] : null;
      if (!attachment || !attachment.url) {
        throw new Error(`Attachment not available for chunk ${ch.index} (message ${ch.messageId})`);
      }

      const streamResp = await axios.get(attachment.url, {
        responseType: 'stream',
        validateStatus: (s) => s < 500,
      });

      if (streamResp.status !== 200) {
        throw new Error(`Failed to download chunk ${ch.index}, status ${streamResp.status}`);
      }

      await new Promise((resolve, reject) => {
        streamResp.data.pipe(res, { end: false });
        streamResp.data.on('end', resolve);
        streamResp.data.on('error', reject);
      });
      await new Promise((r) => setTimeout(r, 50));
    }

    logger.download(
      'File download completed',
      {
        fileId: file._id,
        filename: file.originalName,
        userId: req.session.userId,
      },
      req.requestId
    );

    res.end();
  } catch (err) {
    console.error('Download error', err);
    logger.error(
      'Download failed',
      {
        fileId: file._id,
        error: err.message,
        userId: req.session.userId,
      },
      req.requestId
    );
  }
});

// POST /files/:id/delete - delete file + Discord chunk messages
router.post('/:id/delete', requireAuth, csrfMiddleware, async (req, res) => {
  const fileId = req.params.id;

  const file = await FileModel.findOne({
    _id: fileId,
    userId: req.session.userId,
  });
  if (!file) {
    return res.status(404).send('File not found');
  }

  try {
    for (const ch of file.chunks) {
      try {
        await deleteChunkFromChannel(ch.channelId || file.channelId, ch.messageId);
      } catch (err) {
        logger.error(
          'Failed to delete Discord message',
          { messageId: ch.messageId, error: err.message },
          req.requestId
        );
      }
    }

    await FileModel.deleteOne({ _id: fileId });

    logger.upload(
      'File deleted successfully',
      { fileId, userId: req.session.userId },
      req.requestId
    );

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ ok: true });
    }
    res.redirect('/');
  } catch (err) {
    logger.error('File delete failed', { fileId, error: err.message }, req.requestId);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ ok: false, error: err.message });
    }
    res.status(500).send('Delete failed');
  }
});

// GET /files/profile - user profile (default Discord channel)
router.get('/profile', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).select('-password').lean();
  res.render('profile', {
    user,
    csrfToken: generateCsrfToken(req),
    error: null,
    success: null,
  });
});

// POST /files/profile - update default Discord channel
router.post(
  '/profile',
  requireAuth,
  csrfMiddleware,
  [
    body('discordChannelId')
      .optional()
      .trim()
      .isLength({ min: 1, max: 30 })
      .withMessage('Discord channel ID must be 1-30 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const user = await User.findById(req.session.userId).select('-password').lean();
      return res.render('profile', {
        user,
        csrfToken: generateCsrfToken(req),
        error: errors.array()[0].msg,
        success: null,
      });
    }

    try {
      await User.findByIdAndUpdate(req.session.userId, {
        discordChannelId: req.body.discordChannelId || '',
      });
      req.session.username = (await User.findById(req.session.userId)).username;
      const user = await User.findById(req.session.userId).select('-password').lean();
      return res.render('profile', {
        user,
        csrfToken: generateCsrfToken(req),
        error: null,
        success: 'Default Discord channel updated.',
      });
    } catch (err) {
      const user = await User.findById(req.session.userId).select('-password').lean();
      return res.render('profile', {
        user,
        csrfToken: generateCsrfToken(req),
        error: 'Update failed.',
        success: null,
      });
    }
  }
);

module.exports = router;
