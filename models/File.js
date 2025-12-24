// models/File.js
const mongoose = require("mongoose");

const ChunkSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  size: Number,
  channelId: String,
  messageId: String,
  attachmentId: String,
  sha256: String,
  uploadedAt: Date,
});

const FileSchema = new mongoose.Schema({
  originalName: String,
  size: Number,
  mimeType: String,
  chunkSize: Number,
  chunkCount: Number,
  status: {
    type: String,
    enum: ["uploading", "uploaded", "failed"],
    default: "uploading",
  },
  chunks: [ChunkSchema],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("File", FileSchema);
