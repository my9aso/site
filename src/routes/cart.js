const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth); // корзина доступна только после входа

const MAX_QTY = 99;

const CART_SQL = `
  SELECT c.product_id, c.quantity,
         p.title, p.price, p.image_url, p.stock, p.is_active
    FROM cart_items c
    JOIN products p ON p.id = c.product_id
   WHERE c.user_id = ?
   ORDER BY c.id`;

async function buildCart(userId) {
  const [rows] = await pool.query(CART_SQL, [userId]);
  const items = rows.map((row) => ({
    productId: row.product_id,
    title: row.title,
    price: row.price,
    image_url: row.image_url,
    stock: row.stock,
    is_active: !!row.is_active,
    quantity: row.quantity,
    sum: Math.round(row.price * row.quantity * 100) / 100
  }));

  return {
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    total: Math.round(items.reduce((sum, item) => sum + item.sum, 0) * 100) / 100
  };
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Некорректный id товара');
  return id;
}

// Что лежит в корзине
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await buildCart(req.user.id));
  })
);

// Добавить товар: { productId, quantity }
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const productId = parseId(req.body?.productId);
    const quantity = Math.trunc(Number(req.body?.quantity ?? 1));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw httpError(400, `Количество — от 1 до ${MAX_QTY}`);
    }

    const [products] = await pool.query(
      'SELECT id, stock, is_active FROM products WHERE id = ? LIMIT 1',
      [productId]
    );
    if (products.length === 0 || !products[0].is_active) throw httpError(404, 'Товар не найден');
    if (products[0].stock < 1) throw httpError(409, 'Товара нет в наличии');

    // Если товар уже в корзине — увеличиваем количество
    await pool.query(
      `INSERT INTO cart_items (user_id, product_id, quantity)
            VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = LEAST(quantity + VALUES(quantity), ?)`,
      [req.user.id, productId, quantity, MAX_QTY]
    );

    res.json(await buildCart(req.user.id));
  })
);

// Изменить количество: { quantity } ; 0 — убрать
router.patch(
  '/:productId',
  asyncHandler(async (req, res) => {
    const productId = parseId(req.params.productId);
    const quantity = Math.trunc(Number(req.body?.quantity));

    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) {
      throw httpError(400, `Количество — от 0 до ${MAX_QTY}`);
    }

    if (quantity === 0) {
      await pool.query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [
        req.user.id,
        productId
      ]);
    } else {
      const [result] = await pool.query(
        'UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?',
        [quantity, req.user.id, productId]
      );
      if (result.affectedRows === 0) throw httpError(404, 'Этого товара нет в корзине');
    }

    res.json(await buildCart(req.user.id));
  })
);

// Убрать один товар
router.delete(
  '/:productId',
  asyncHandler(async (req, res) => {
    const productId = parseId(req.params.productId);
    await pool.query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [
      req.user.id,
      productId
    ]);
    res.json(await buildCart(req.user.id));
  })
);

// Очистить корзину
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
    res.json(await buildCart(req.user.id));
  })
);

module.exports = router;
