const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');

const router = express.Router();

// Список товаров каталога (для всех, без входа)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, title, description, price, image_url, stock
         FROM products
        WHERE is_active = 1
        ORDER BY id DESC`
    );
    res.json({ products: rows });
  })
);

// Один товар
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Некорректный id товара');

    const [rows] = await pool.query(
      `SELECT id, title, description, price, image_url, stock
         FROM products
        WHERE id = ? AND is_active = 1 LIMIT 1`,
      [id]
    );
    if (rows.length === 0) throw httpError(404, 'Товар не найден');
    res.json({ product: rows[0] });
  })
);

module.exports = router;
