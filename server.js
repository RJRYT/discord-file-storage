// server.js
require("dotenv").config();
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const multer = require("multer");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { produceChunks, sha256 } = require("./utils/chunker");
const {
  postChunkToChannel,
  deleteChunkFromChannel,
  fetchMessage,
} = require("./utils/discord");
const FileModel = require("./models/File");
const axios = require("axios");
const logger = require("./utils/logger");

const app = express();
app.set("view engine", "ejs");
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, "public")));

// TMP upload folder
const TMP_DIR = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const upload = multer({ dest: TMP_DIR });

// config
const PORT = process.env.PORT || 3000;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-files";
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_BYTES || "26214400", 10); // default 25MB

// DB init
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => logger.db("MongoDB connected", { uri: MONGO_URI }))
  .catch((err) => {
    logger.error("MongoDB connection failed", { error: err.message });
    process.exit(1);
  });

app.use((req, res, next) => {
  res.locals.CHUNK_SIZE_MB = (CHUNK_SIZE / (1024 * 1024)).toFixed(2);
  req.requestId = logger.genRequestId();
  logger.http(
    "Incoming request",
    {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    },
    req.requestId
  );
  next();
});

// Routes

// Home - list files
app.get("/", async (req, res) => {
  const files = await FileModel.find().sort({ createdAt: -1 }).lean();
  res.render("index", { files });
});

// Upload form
app.get("/upload", (req, res) => {
  res.render("upload");
});

// Handle upload (file field name: file)
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    if (req.xhr)
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    return res.status(400).send("No file uploaded");
  }

  const tmpPath = req.file.path;
  const originalName = req.file.originalname;
  const size = req.file.size;
  const mimeType = req.file.mimetype;

  const chunkCount = Math.ceil(size / CHUNK_SIZE);

  const uploadTimer = logger.startTimer();
  logger.upload(
    "File upload started",
    {
      filename: originalName,
      size,
      mimeType,
      chunkCount,
    },
    req.requestId
  );

  const fileDoc = await FileModel.create({
    originalName,
    size,
    mimeType,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    chunks: [],
    status: "uploading",
  });

  try {
    // sequentially produce chunks and upload to Discord
    await produceChunks(tmpPath, CHUNK_SIZE, async (buffer, index) => {
      logger.upload(
        "Chunk created",
        {
          fileId: fileDoc._id,
          index,
          size: buffer.length,
        },
        req.requestId
      );
      const chunkHash = sha256(buffer);
      const chunkFilename = `${fileDoc._id}_chunk_${index}`;

      const chunkTimer = logger.startTimer();
      logger.discord(
        "Uploading chunk to Discord",
        {
          fileId: fileDoc._id,
          index,
        },
        req.requestId
      );

      // Upload chunk to discord channel
      const message = await postChunkToChannel(buffer, chunkFilename, index);
      const attachment =
        message.attachments && message.attachments[0]
          ? message.attachments[0]
          : null;

      logger.discord(
        "Chunk uploaded to Discord",
        {
          fileId: fileDoc._id,
          index,
          messageId: message.id,
          channelId: message.channel_id,
          took: `${logger.endTimerMs(chunkTimer)} ms`,
        },
        req.requestId
      );
      // store chunk metadata
      await FileModel.findByIdAndUpdate(fileDoc._id, {
        $push: {
          chunks: {
            index,
            size: buffer.length,
            channelId:
              message.channel_id || process.env.DISCORD_UPLOAD_CHANNEL_ID,
            messageId: message.id,
            attachmentId: attachment?.id,
            sha256: chunkHash,
            uploadedAt: new Date(),
          },
        },
      });
      // gentle pause between uploads
      await new Promise((r) => setTimeout(r, 250));
    });

    // mark complete
    fileDoc.status = "uploaded";
    await fileDoc.save();
    logger.upload(
      "File upload completed",
      {
        fileId: fileDoc._id,
        originalName,
        totalChunks: chunkCount,
        totalTime: `${logger.endTimerMs(uploadTimer)} ms`,
      },
      req.requestId
    );

    // delete tmp
    fs.unlink(tmpPath, () => {});

    // if XHR (AJAX) return JSON, otherwise redirect (legacy)
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.json({ ok: true, fileId: fileDoc._id });
    }
    return res.redirect(`/files/${fileDoc._id}`);
  } catch (err) {
    console.error("Upload failed", err);
    await FileModel.findByIdAndUpdate(fileDoc._id, { status: "failed" });
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {}
    logger.error(
      "File upload failed",
      {
        fileId: fileDoc._id,
        error: err.message,
      },
      req.requestId
    );
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.status(500).json({ ok: false, error: err.message });
    }
    return res.status(500).send("Upload failed: " + err.message);
  }
});

// File detail
app.get("/files/:id", async (req, res) => {
  const file = await FileModel.findById(req.params.id).lean();
  if (!file) return res.status(404).send("Not found");
  res.render("file", { file });
});

// Download / stream assembled file
app.get("/files/:id/download", async (req, res) => {
  const file = await FileModel.findById(req.params.id).lean();
  if (!file || file.status !== "uploaded")
    return res.status(404).send("File not available");

  logger.download(
    "Download requested",
    {
      fileId: file._id,
      filename: file.originalName,
    },
    req.requestId
  );

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.originalName}"`
  );
  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");

  // sort chunks by index
  const chunks = (file.chunks || []).sort((a, b) => a.index - b.index);

  try {
    for (const ch of chunks) {
      logger.download(
        "Fetching chunk message",
        {
          fileId: file._id,
          chunkIndex: ch.index,
          messageId: ch.messageId,
        },
        req.requestId
      );
      // re-fetch message to get fresh signed url
      const message = await fetchMessage(ch.channelId, ch.messageId);
      const attachment =
        message.attachments && message.attachments[0]
          ? message.attachments[0]
          : null;
      if (!attachment || !attachment.url) {
        throw new Error(
          `Attachment not available for chunk ${ch.index} (message ${ch.messageId})`
        );
      }
      const url = attachment.url;

      // stream chunk bytes from discord CDN to response
      const streamResp = await axios.get(url, {
        responseType: "stream",
        validateStatus: (s) => s < 500,
      });

      if (streamResp.status !== 200) {
        throw new Error(
          `Failed to download chunk ${ch.index}, status ${streamResp.status}`
        );
      }
      logger.download(
        "Streaming chunk from CDN",
        {
          fileId: file._id,
          chunkIndex: ch.index,
        },
        req.requestId
      );

      // pipe chunk stream and wait for it to finish before continuing
      await new Promise((resolve, reject) => {
        streamResp.data.pipe(res, { end: false });
        streamResp.data.on("end", resolve);
        streamResp.data.on("error", reject);
      });
      // small pause to be gentle
      await new Promise((r) => setTimeout(r, 50));
    }
    logger.download(
      "File download completed",
      {
        fileId: file._id,
        filename: file.originalName,
      },
      req.requestId
    );

    res.end();
  } catch (err) {
    console.error("Download error", err);
    logger.error(
      "Download failed",
      {
        fileId: file._id,
        error: err.message,
      },
      req.requestId
    );
    // If streaming already started, we can't easily change status code.
    // Client will see truncated file or connection error.
    // Optionally log and inform via separate UI.
  }
});

// Delete file + all Discord chunk messages
app.post("/files/:id/delete", async (req, res) => {
  const requestId = req.requestId;
  const fileId = req.params.id;

  const file = await FileModel.findById(fileId);
  if (!file) {
    logger.error("Delete failed: file not found", { fileId }, requestId);
    return res.status(404).send("File not found");
  }

  logger.upload(
    "Delete requested",
    {
      fileId,
      chunks: file.chunks.length,
    },
    requestId
  );

  try {
    // delete Discord messages (chunks)
    for (const ch of file.chunks) {
      try {
        logger.discord(
          "Deleting Discord chunk message",
          {
            chunkIndex: ch.index,
            messageId: ch.messageId,
          },
          requestId
        );

        await deleteChunkFromChannel(ch.channelId, ch.messageId);
      } catch (err) {
        // log but continue (do not block full delete)
        logger.error(
          "Failed to delete Discord message",
          {
            messageId: ch.messageId,
            error: err.message,
          },
          requestId
        );
      }
    }

    // delete DB record
    await FileModel.deleteOne({ _id: fileId });

    logger.upload(
      "File deleted successfully",
      {
        fileId,
      },
      requestId
    );

    res.redirect("/");
  } catch (err) {
    logger.error(
      "File delete failed",
      {
        fileId,
        error: err.message,
      },
      requestId
    );

    res.status(500).send("Delete failed");
  }
});

app.listen(PORT, () => logger.server("Server started", { port: PORT }));
