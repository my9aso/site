const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Оформить заявку: берём всё из корзины, создаём заказ со статусом pending.
// Админ увидит его в админке и примет/отклонит.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const comment =
      typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 500) || null : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // FOR UPDATE — блокируем строки, чтобы двое не купили последний товар одновременно
      const [items] = await conn.query(
        `SELECT c.product_id, c.quantity, p.title, p.price, p.stock, p.is_active
           FROM cart_items c
           JOIN products p ON p.id = c.product_id
          WHERE c.user_id = ?
          FOR UPDATE`,
        [req.user.id]
      );

      if (items.length === 0) throw httpError(400, 'Корзина пуста');

      for (const item of items) {
        if (!item.is_active) throw httpError(409, `Товар «${item.title}» больше не продаётся`);
        if (item.quantity > item.stock) {
          throw httpError(409, `Товара «${item.title}» осталось только ${item.stock} шт.`);
        }
      }

      const total = Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100;

      // Денег должно хватать уже на этапе оформления (как было на сайте)
      const [users] = await conn.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [
        req.user.id
      ]);
      if (users[0].balance < total) {
        throw httpError(
          409,
          `Недостаточно средств: нужно ${total} ₽, на балансе ${users[0].balance} ₽. Запроси деньги у администратора.`
        );
      }

      const [orderResult] = await conn.query(
        'INSERT INTO orders (user_id, status, total, comment) VALUES (?, "pending", ?, ?)',
        [req.user.id, total, comment]
      );
      const orderId = orderResult.insertId;

      const values = items.map((item) => [
        orderId,
        item.product_id,
        item.title,
        item.price,
        item.quantity
      ]);
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, title, price, quantity) VALUES ?',
        [values]
      );

      await conn.query('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);

      await conn.commit();
      res.status(201).json({
        order: { id: orderId, status: 'pending', total, comment }
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// Мои заявки с составом
router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const [orders] = await pool.query(
      `SELECT id, status, total, comment, created_at, decided_at
         FROM orders
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 100`,
      [req.user.id]
    );

    if (orders.length === 0) return res.json({ orders: [] });

    const ids = orders.map((o) => o.id);
    const [items] = await pool.query(
      `SELECT order_id, product_id, title, price, quantity
         FROM order_items
        WHERE order_id IN (?)`,
      [ids]
    );

    const byOrder = new Map();
    for (const item of items) {
      if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
      byOrder.get(item.order_id).push(item);
    }

    res.json({
      orders: orders.map((order) => ({ ...order, items: byOrder.get(order.id) || [] }))
    });
  })
);

module.exports = router;
