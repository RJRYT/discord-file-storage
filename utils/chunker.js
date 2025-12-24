// utils/chunker.js
const fs = require("fs");
const crypto = require("crypto");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Read file by stream and produce sequential chunk buffers.
 * @param {string} path
 * @param {number} chunkSize
 * @param {(buf: Buffer, index: number) => Promise<void>} onChunk
 */
async function produceChunks(filePath, chunkSize, onChunk) {
  return new Promise((resolve, reject) => {
    const read = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    let bufferParts = [];
    let bufferLen = 0;
    let index = 0;

    read.on("data", async (chunk) => {
      read.pause(); // process sync-ish to avoid memory spikes
      bufferParts.push(chunk);
      bufferLen += chunk.length;

      // While we have at least chunkSize, emit
      while (bufferLen >= chunkSize) {
        // combine parts to form one chunkSize buffer
        let needed = chunkSize;
        const outParts = [];
        while (needed > 0) {
          const part = bufferParts.shift();
          if (part.length <= needed) {
            outParts.push(part);
            needed -= part.length;
          } else {
            // split the part
            outParts.push(part.slice(0, needed));
            bufferParts.unshift(part.slice(needed));
            needed = 0;
          }
        }
        bufferLen -= chunkSize;
        const outBuf = Buffer.concat(outParts, chunkSize);
        try {
          await onChunk(outBuf, index++);
        } catch (err) {
          read.destroy(err);
          return;
        }
      }
      read.resume();
    });

    read.on("end", async () => {
      // leftover
      if (bufferLen > 0) {
        const outBuf = Buffer.concat(bufferParts, bufferLen);
        try {
          await onChunk(outBuf, index++);
        } catch (err) {
          return reject(err);
        }
      }
      resolve();
    });

    read.on("error", (err) => reject(err));
  });
}

module.exports = { produceChunks, sha256 };
