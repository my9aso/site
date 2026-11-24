const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Некорректный id товара');
  return id;
}

// Список избранного (сердечко)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.price, p.image_url, p.stock
         FROM favorites f
         JOIN products p ON p.id = f.product_id
        WHERE f.user_id = ? AND p.is_active = 1
        ORDER BY f.id DESC`,
      [req.user.id]
    );
    res.json({ favorites: rows });
  })
);

// Добавить в избранное (повторное добавление не создаёт дубль)
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const productId = parseId(req.body?.productId);

    const [products] = await pool.query(
      'SELECT id FROM products WHERE id = ? AND is_active = 1 LIMIT 1',
      [productId]
    );
    if (products.length === 0) throw httpError(404, 'Товар не найден');

    await pool.query(
      'INSERT IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)',
      [req.user.id, productId]
    );
    res.status(201).json({ ok: true, favorite: true });
  })
);

// Убрать из избранного
router.delete(
  '/:productId',
  asyncHandler(async (req, res) => {
    const productId = parseId(req.params.productId);
    await pool.query('DELETE FROM favorites WHERE user_id = ? AND product_id = ?', [
      req.user.id,
      productId
    ]);
    res.json({ ok: true, favorite: false });
  })
);

module.exports = router;
