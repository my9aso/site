/*
 * Мини-клиент для работы с бэкендом из твоих HTML-страниц.
 *
 * Подключение на странице:
 *   <script src="/api-client.js"></script>
 *
 * Если сайт открывается с другого адреса, чем API, задай базу ДО подключения:
 *   <script>window.API_BASE = 'https://api.мой-сайт.ru';</script>
 *
 * Все запросы идут с credentials: 'include' — cookie входа сохраняется сама.
 */
(function (global) {
  const API_BASE = String(global.API_BASE || '').replace(/\/+$/, '');

  async function request(path, options) {
    const opts = options || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: {}
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch(API_BASE + '/api' + path, init);
    } catch {
      throw new Error('Сервер недоступен. Проверь, запущен ли Node.js');
    }

    let data = {};
    try {
      data = await res.json();
    } catch {
      /* пустой ответ */
    }

    if (!res.ok) {
      const err = new Error(data.error || 'Ошибка запроса (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const API = {
    request: request,

    // --- Аккаунт ---
    register: function (username, email, password) {
      return request('/auth/register', {
        method: 'POST',
        body: { username: username, email: email, password: password }
      });
    },
    login: function (login, password) {
      return request('/auth/login', { method: 'POST', body: { login: login, password: password } });
    },
    logout: function () {
      return request('/auth/logout', { method: 'POST' });
    },
    me: function () {
      return request('/auth/me');
    },
    changePassword: function (currentPassword, newPassword) {
      return request('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: currentPassword, newPassword: newPassword }
      });
    },

    // --- Каталог ---
    products: {
      list: function () {
        return request('/products');
      },
      get: function (id) {
        return request('/products/' + id);
      }
    },

    // --- Корзина (нужен вход) ---
    cart: {
      get: function () {
        return request('/cart');
      },
      add: function (productId, quantity) {
        return request('/cart', { method: 'POST', body: { productId: productId, quantity: quantity || 1 } });
      },
      setQuantity: function (productId, quantity) {
        return request('/cart/' + productId, { method: 'PATCH', body: { quantity: quantity } });
      },
      remove: function (productId) {
        return request('/cart/' + productId, { method: 'DELETE' });
      },
      clear: function () {
        return request('/cart', { method: 'DELETE' });
      }
    },

    // --- Заявки покупателя ---
    checkout: function (comment) {
      return request('/orders', { method: 'POST', body: { comment: comment || '' } });
    },
    myOrders: function () {
      return request('/orders/my');
    },

    // --- Избранное (нужен вход) ---
    favorites: {
      list: function () {
        return request('/favorites');
      },
      add: function (productId) {
        return request('/favorites', { method: 'POST', body: { productId: productId } });
      },
      remove: function (productId) {
        return request('/favorites/' + productId, { method: 'DELETE' });
      }
    },

    // --- Запросы денег (нужен вход) ---
    money: {
      my: function () {
        return request('/money-requests/my');
      },
      request: function (amount) {
        return request('/money-requests', { method: 'POST', body: { amount: amount } });
      }
    },

    // --- Админка ---
    admin: {
      orders: function (status) {
        return request('/admin/orders' + (status ? '?status=' + encodeURIComponent(status) : ''));
      },
      order: function (id) {
        return request('/admin/orders/' + id);
      },
      accept: function (id) {
        return request('/admin/orders/' + id + '/accept', { method: 'POST' });
      },
      reject: function (id) {
        return request('/admin/orders/' + id + '/reject', { method: 'POST' });
      },
      moneyRequests: function (status) {
        return request('/admin/money-requests' + (status ? '?status=' + encodeURIComponent(status) : ''));
      },
      acceptMoney: function (id) {
        return request('/admin/money-requests/' + id + '/accept', { method: 'POST' });
      },
      rejectMoney: function (id) {
        return request('/admin/money-requests/' + id + '/reject', { method: 'POST' });
      },
      pendingCount: function () {
        return request('/admin/pending-count');
      },
      users: function () {
        return request('/admin/users');
      },
      products: {
        list: function () {
          return request('/admin/products');
        },
        create: function (data) {
          return request('/admin/products', { method: 'POST', body: data });
        },
        update: function (id, data) {
          return request('/admin/products/' + id, { method: 'PATCH', body: data });
        },
        remove: function (id) {
          return request('/admin/products/' + id, { method: 'DELETE' });
        }
      }
    }
  };

  global.API = API;
})(window);
