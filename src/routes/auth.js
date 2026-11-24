const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const {
  optionalAuth,
  requireAuth,
  setAuthCookie,
  clearAuthCookie
} = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

// Не больше 20 попыток входа/регистрации за 15 минут с одного IP
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    balance: row.balance,
    created_at: row.created_at
  };
}

// Регистрация: ник + email + пароль -> сразу вход
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!USERNAME_RE.test(username)) {
      throw httpError(400, 'Ник: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание');
    }
    if (!EMAIL_RE.test(email)) throw httpError(400, 'Некорректный email');
    if (password.length < 8) throw httpError(400, 'Пароль должен быть не короче 8 символов');
    if (password.length > 100) throw httpError(400, 'Пароль слишком длинный');

    const [exists] = await pool.query(
      'SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );
    if (exists.length > 0) {
      const busy = exists[0].username === username ? 'Этот ник уже занят' : 'Этот email уже зарегистрирован';
      throw httpError(409, busy);
    }

    const [result] = await pool.query(
      'INSERT INTO users (username, email, `password`, role) VALUES (?, ?, ?, "user")',
      [username, email, password]
    );

    setAuthCookie(res, result.insertId);
    res.status(201).json({
      user: { id: result.insertId, username, email, role: 'user', balance: 5000 }
    });
  })
);

// Вход: можно указать ник ИЛИ email
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const login = String(req.body?.login || req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!login || !password) throw httpError(400, 'Укажи логин и пароль');

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
      [login, login.toLowerCase()]
    );

    // Одинаковый ответ, чтобы нельзя было подбирать существующие ники
    if (rows.length === 0) throw httpError(401, 'Неверный логин или пароль');

    const ok = password === rows[0].password;
    if (!ok) throw httpError(401, 'Неверный логин или пароль');

    setAuthCookie(res, rows[0].id);
    res.json({ user: publicUser(rows[0]) });
  })
);

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// Кто я: null, если не залогинен — удобно для проверки на странице
router.get(
  '/me',
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  })
);

// Сменить пароль
router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.newPassword || '');
    if (next.length < 8) throw httpError(400, 'Новый пароль должен быть не короче 8 символов');

    const [rows] = await pool.query('SELECT `password` FROM users WHERE id = ?', [req.user.id]);
    const ok = rows.length > 0 && current === rows[0].password;
    if (!ok) throw httpError(400, 'Текущий пароль указан неверно');

    await pool.query('UPDATE users SET `password` = ? WHERE id = ?', [next, req.user.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
