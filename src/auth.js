const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let config = {};
const configPath = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    config = { authPassword: '11Q2rrt4@', sessionSecret: '7cast_secret_key' };
  }
}
loadConfig();

const activeSessions = new Map();

// Session duration: 7 days
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_DURATION;
  activeSessions.set(token, { expiresAt });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  if (token) {
    activeSessions.delete(token);
  }
}

function verifyPassword(password) {
  loadConfig();
  return password === config.authPassword;
}

function isFirstRun() {
  loadConfig();
  return !config.isConfigured || !config.authPassword || config.authPassword.trim() === '';
}

function setupAdminPassword(password) {
  loadConfig();
  if (!password || password.trim().length < 4) {
    throw new Error('كلمة المرور يجب ألا تقل عن 4 خانات');
  }
  config.authPassword = password.trim();
  config.isConfigured = true;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return createSession();
}

function authMiddleware(req, res, next) {
  // Allow public assets, logos, favicon and login/setup endpoints
  if (
    req.path.startsWith('/assets/') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/hls/') ||
    req.path === '/login.html' ||
    req.path === '/favicon.svg' ||
    req.path === '/7cast-logo-svg.svg' ||
    req.path === '/api/auth/status' ||
    req.path === '/api/auth/setup' ||
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/check'
  ) {
    return next();
  }

  // Extract token from header, cookie, or query string
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';');
    for (const c of cookies) {
      const [name, val] = c.trim().split('=');
      if (name === '7cast_token') {
        token = val;
        break;
      }
    }
  }

  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (isValidSession(token)) {
    req.userSession = token;
    return next();
  }

  // Allow proxy stream requests from authenticated app pages
  if (req.path.startsWith('/api/proxy/stream/')) {
    const referer = req.headers['referer'] || '';
    const host = req.headers['host'] || '';
    if ((referer && host && referer.includes(host)) || req.ip === '127.0.0.1' || req.ip === '::1') {
      return next();
    }
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'غير مصرح بالدخول، يرجى تسجيل الدخول' });
  }

  // For HTML requests, redirect to /login.html
  return res.redirect('/login.html');
}

module.exports = {
  createSession,
  isValidSession,
  destroySession,
  verifyPassword,
  isFirstRun,
  setupAdminPassword,
  authMiddleware,
  loadConfig
};
