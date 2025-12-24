// utils/logger.js
const crypto = require("crypto");

const colors = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

const scopes = {
  SERVER: { color: colors.green, icon: "🟢" },
  DB: { color: colors.magenta, icon: "🟣" },
  HTTP: { color: colors.blue, icon: "🔵" },
  UPLOAD: { color: colors.yellow, icon: "🟡" },
  DOWNLOAD: { color: colors.cyan, icon: "🟦" },
  DISCORD: { color: colors.blue, icon: "🟦" },
  ERROR: { color: colors.red, icon: "🔴" },
};

const LEVELS = {
  ERROR: 0,
  INFO: 1,
  DEBUG: 2,
};

const CURRENT_LEVEL =
  LEVELS[(process.env.LOG_LEVEL || "INFO").toUpperCase()] ?? 1;

function time() {
  return new Date().toLocaleTimeString();
}

function genRequestId() {
  return crypto.randomUUID().slice(0, 8);
}

function printMeta(meta = {}) {
  const keys = Object.keys(meta);
  if (!keys.length) return;

  keys.forEach((key, idx) => {
    const prefix = idx === keys.length - 1 ? "└─" : "├─";
    console.log(
      `${colors.gray}            ${prefix} ${key}: ${meta[key]}${colors.reset}`
    );
  });
}

function log(level, scope, message, meta, requestId) {
  if (LEVELS[level] > CURRENT_LEVEL) return;

  const cfg = scopes[scope] || scopes.SERVER;
  const req = requestId ? `${colors.gray}[${requestId}]${colors.reset} ` : "";

  console.log(
    `${colors.gray}[${time()}]${colors.reset} ${req}${cfg.icon} ${
      cfg.color
    }${scope.padEnd(8)}${colors.reset} ${message}`
  );
  printMeta(meta);
}

/* ───────── PUBLIC API ───────── */

module.exports = {
  LEVELS,
  genRequestId,

  server: (msg, meta) => log("INFO", "SERVER", msg, meta),
  db: (msg, meta) => log("INFO", "DB", msg, meta),
  http: (msg, meta, rid) => log("INFO", "HTTP", msg, meta, rid),

  upload: (msg, meta, rid) => log("INFO", "UPLOAD", msg, meta, rid),
  download: (msg, meta, rid) => log("INFO", "DOWNLOAD", msg, meta, rid),
  discord: (msg, meta, rid) => log("DEBUG", "DISCORD", msg, meta, rid),

  error: (msg, meta, rid) => log("ERROR", "ERROR", msg, meta, rid),

  /* ───────── Timing helpers ───────── */
  startTimer: () => process.hrtime.bigint(),
  endTimerMs: (start) => Number((process.hrtime.bigint() - start) / 1_000_000n),
};
