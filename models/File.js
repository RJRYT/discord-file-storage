// models/File.js
const mongoose = require('mongoose');

const ChunkSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  size: Number,
  channelId: String,
  messageId: String,
  attachmentId: String,
  sha256: String,
  uploadedAt: Date,
  status: {
    type: String,
    enum: ['pending', 'uploaded', 'failed'],
    default: 'pending',
  },
});

const FileSchema = new mongoose.Schema({
  originalName: String,
  size: Number,
  mimeType: String,
  chunkSize: Number,
  chunkCount: Number,
  status: {
    type: String,
    enum: ['queued', 'uploading', 'completed', 'failed'],
    default: 'queued',
  },
  uploadStatus: {
    type: String,
    enum: ['queued', 'uploading', 'completed', 'failed'],
    default: 'queued',
  },
  uploadedChunks: { type: Number, default: 0 },
  chunks: [ChunkSchema],
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channelId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

FileSchema.index({ userId: 1, createdAt: -1 });
FileSchema.index({ channelId: 1 });

module.exports = mongoose.model('File', FileSchema);
