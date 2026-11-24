const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');

const COOKIE_NAME = 'token';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 дней

function readToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Достаём пользователя из cookie (если он вообще залогинен)
async function loadUser(req) {
  const token = readToken(req);
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null; // просроченный или подделанный токен
  }

  // Роль и баланс читаем из базы, чтобы изменения применялись сразу
  const [rows] = await pool.query(
    'SELECT id, username, email, role, balance, created_at FROM users WHERE id = ? LIMIT 1',
    [payload.sub]
  );
  return rows[0] || null;
}

const optionalAuth = asyncHandler(async (req, res, next) => {
  req.user = await loadUser(req);
  next();
});

const requireAuth = asyncHandler(async (req, res, next) => {
  req.user = await loadUser(req);
  if (!req.user) return res.status(401).json({ error: 'Нужно войти в аккаунт' });
  next();
});

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Нужно войти в аккаунт' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ только для админа' });
  next();
}

function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // JS на странице не может украсть cookie
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: COOKIE_MAX_AGE
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure
  });
}

module.exports = {
  COOKIE_NAME,
  optionalAuth,
  requireAuth,
  requireAdmin,
  setAuthCookie,
  clearAuthCookie
};
