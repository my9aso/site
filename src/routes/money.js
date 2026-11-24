const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_REQUEST = 100000;

// Мои запросы на выдачу денег
router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, amount, status, created_at, decided_at
         FROM money_requests
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 50`,
      [req.user.id]
    );
    res.json({ requests: rows });
  })
);

// Отправить запрос админу: { amount }
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 1) throw httpError(400, 'Сумма должна быть больше нуля');
    if (amount > MAX_REQUEST) throw httpError(400, `Одна заявка — не больше ${MAX_REQUEST} ₽`);

    const rounded = Math.round(amount * 100) / 100;

    const [result] = await pool.query(
      'INSERT INTO money_requests (user_id, amount, status) VALUES (?, ?, "pending")',
      [req.user.id, rounded]
    );

    res.status(201).json({
      request: { id: result.insertId, amount: rounded, status: 'pending' }
    });
  })
);

module.exports = router;
