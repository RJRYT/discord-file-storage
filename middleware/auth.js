const User = require('../models/User');

/**
 * Require an authenticated user. Redirects to /login otherwise.
 */
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

/**
 * Require a guest (not logged in). Redirects to / otherwise.
 */
function requireGuest(req, res, next) {
  if (req.session.userId) {
    return res.redirect('/');
  }
  next();
}

/**
 * Attach the full user document to req.user for authenticated routes.
 */
async function loadUser(req, res, next) {
  if (!req.session.userId) return next();
  try {
    const user = await User.findById(req.session.userId).select('-password');
    req.user = user || null;
  } catch (err) {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, requireGuest, loadUser };
