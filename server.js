// server.js
require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { requireAuth, loadUser } = require('./middleware/auth');
const { generateCsrfToken } = require('./middleware/csrf');
const FileModel = require('./models/File');
const authRoutes = require('./routes/auth');
const filesRoutes = require('./routes/files');

const app = express();
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, 'public')));

// TMP upload folder
const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// config
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/discord-files';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_BYTES || '26214400', 10); // default 25MB

// DB init
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => logger.db('MongoDB connected', { uri: MONGO_URI }))
  .catch((err) => {
    logger.error('MongoDB connection failed', { error: err.message });
    process.exit(1);
  });

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // EJS inline styles/scripts; tighten in production
    crossOriginEmbedderPolicy: false,
  })
);

// Request logging + locals
app.use((req, res, next) => {
  res.locals.CHUNK_SIZE_MB = (CHUNK_SIZE / (1024 * 1024)).toFixed(2);
  res.locals.user = req.user || null;
  res.locals.active = res.locals.active ?? null;
  res.locals.csrfToken = req.session?.csrfToken ?? generateCsrfToken(req);
  res.locals.form = res.locals.form ?? null;
  res.locals.error = res.locals.error ?? null;
  res.locals.message = res.locals.message ?? null;
  req.requestId = logger.genRequestId();
  logger.http(
    'Incoming request',
    {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    },
    req.requestId
  );
  next();
});

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json());

// Session store (MongoDB)
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
    store: MongoStore.create({
      mongoUrl: MONGO_URI,
      collectionName: 'sessions',
      ttl: 60 * 60 * 24 * 7, // 7 days
    }),
  })
);

// Load user on every request
app.use(loadUser);

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // requests per window
  message: 'Too many attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // uploads per hour per IP
  message: 'Upload rate limit exceeded, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.get('/login', (req, res) => res.redirect('/auth/login'));
app.use('/auth', authLimiter, authRoutes);
app.use('/files', uploadLimiter, filesRoutes);

// Home - list files (auth required)
app.get('/', requireAuth, async (req, res) => {
  const files = await FileModel.find({ userId: req.session.userId }).sort({ createdAt: -1 }).lean();
  res.render('index', {
    files,
    user: req.user,
    csrfToken: generateCsrfToken(req),
    active: 'files',
  });
});

app.listen(PORT, () => logger.server('Server started', { port: PORT }));
