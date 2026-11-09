const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { requireGuest, requireAuth, loadUser } = require('../middleware/auth');
const { generateCsrfToken } = require('../middleware/csrf');
const { createChannel } = require('../utils/discord');

router.use(loadUser);

// GET /register
router.get('/register', requireGuest, (req, res) => {
  res.render('register', {
    csrfToken: generateCsrfToken(req),
    error: null,
    form: null,
    isAuthPage: true,
  });
});

// POST /register
router.post(
  '/register',
  requireGuest,
  [
    body('username')
      .trim()
      .isLength({ min: 3, max: 30 })
      .withMessage('Username must be 3-30 characters')
      .isAlphanumeric()
      .withMessage('Username must be alphanumeric'),
    body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('register', {
        csrfToken: generateCsrfToken(req),
        error: errors.array()[0].msg,
        form: req.body,
        isAuthPage: true,
      });
    }

    const { username, email, password } = req.body;

    try {
      const existing = await User.findOne({
        $or: [{ email }, { username }],
      });
      if (existing) {
        return res.render('register', {
          csrfToken: generateCsrfToken(req),
          error: 'Username or email already registered',
          form: req.body,
          isAuthPage: true,
        });
      }

      // Create a private Discord channel for this user
      let discordChannelId = '';
      try {
        discordChannelId = await createChannel(`user-${username}`);
      } catch (chErr) {
        console.error('Discord channel creation failed', chErr.message);
        // Continue without channel — user can still register
      }

      const user = await User.create({
        username,
        email,
        password,
        discordChannelId,
      });

      req.session.userId = user._id;
      req.session.username = user.username;
      return res.redirect('/');
    } catch (err) {
      console.error('Register error', err);
      return res.render('register', {
        csrfToken: generateCsrfToken(req),
        error: 'Registration failed. Try again.',
        form: req.body,
        isAuthPage: true,
      });
    }
  }
);

// GET /login
router.get('/login', requireGuest, (req, res) => {
  res.render('login', {
    csrfToken: generateCsrfToken(req),
    error: null,
    form: null,
    isAuthPage: true,
  });
});

// POST /login
router.post(
  '/login',
  requireGuest,
  [
    body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('login', {
        csrfToken: generateCsrfToken(req),
        error: errors.array()[0].msg,
        form: req.body,
      });
    }

    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.render('login', {
          csrfToken: generateCsrfToken(req),
          error: 'Invalid email or password',
          form: req.body,
        });
      }

      const match = await user.comparePassword(password);
      if (!match) {
        return res.render('login', {
          csrfToken: generateCsrfToken(req),
          error: 'Invalid email or password',
          form: req.body,
        });
      }

      if (!user.isActive) {
        return res.render('login', {
          csrfToken: generateCsrfToken(req),
          error: 'Account is deactivated',
          form: req.body,
        });
      }

      req.session.userId = user._id;
      req.session.username = user.username;
      return res.redirect('/');
    } catch (err) {
      console.error('Login error', err);
      return res.render('login', {
        csrfToken: generateCsrfToken(req),
        error: 'Login failed. Try again.',
        form: req.body,
      });
    }
  }
);

// POST /logout
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error', err);
      return res.redirect('/');
    }
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
