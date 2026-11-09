const crypto = require('crypto');

/**
 * Lightweight double-submit CSRF protection for state-changing routes.
 * - Generates a token stored in the session.
 * - Validates token from either X-CSRF-Token header or _csrf form field.
 */
function csrfMiddleware(req, res, next) {
  // Exempt safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const sessionToken = req.session.csrfToken;
  const headerToken = req.headers['x-csrf-token'];
  const bodyToken = req.body && req.body._csrf;

  const provided = headerToken || bodyToken;

  if (!sessionToken || !provided || provided !== sessionToken) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ ok: false, error: 'CSRF token mismatch' });
    }
    return res.status(403).send('CSRF token mismatch');
  }

  next();
}

function generateCsrfToken(req) {
  if (!req.session) {
    return crypto.randomBytes(32).toString('hex');
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

module.exports = { csrfMiddleware, generateCsrfToken };
