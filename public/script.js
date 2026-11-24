/* ================================================================
   int store — фронтенд, связанный с MySQL через API
   Все данные (аккаунты, корзина, избранное, баланс, заявки)
   теперь хранятся в базе, а не в памяти браузера.
   ================================================================ */

let currentUser = null;                 // { id, username, role, balance } или null
let products = [];                      // каталог из базы
let favorites = [];                     // избранное из базы
let cart = { items: [], count: 0, total: 0 };
let myOrders = [];                      // мои заявки на оплату
let adminMoney = [];                    // запросы денег (для админа)
let adminPayments = [];                 // заявки на оплату (для админа)

const HEART_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>`;

const STATUS_LABEL = {
    pending: 'Ожидает решения',
    accepted: 'Принято / оплачено',
    rejected: 'Отклонено'
};

/* ---------- утилиты ---------- */

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function money(value) {
    return Number(value || 0).toLocaleString('ru-RU');
}

function notify(message, isError) {
    let box = document.getElementById('toast');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast';
        document.body.appendChild(box);
    }
    box.textContent = message;
    box.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(box.timer);
    box.timer = setTimeout(() => { box.className = 'toast'; }, 3500);
}

function emptyCart() {
    return { items: [], count: 0, total: 0 };
}

/* ---------- навигация (как было) ---------- */

function hideAll() {
    ['home-container', 'shop-container', 'about-container', 'favorites-container',
     'cart-container', 'admin-container', 'auth-container'].forEach((id) => {
        document.getElementById(id).classList.add('hidden');
    });
}

function showHome() {
    hideAll();
    document.getElementById('home-container').classList.remove('hidden');
}

function showShop() {
    hideAll();
    document.getElementById('shop-container').classList.remove('hidden');
    renderCatalog();
}

function showAbout() {
    hideAll();
    document.getElementById('about-container').classList.remove('hidden');
}

function showFavorites() {
    hideAll();
    document.getElementById('favorites-container').classList.remove('hidden');
    loadFavorites().then(renderFavorites);
}

function showCart() {
    hideAll();
    document.getElementById('cart-container').classList.remove('hidden');
    if (!currentUser) {
        document.getElementById('cart-items').innerHTML =
            '<p>Войдите в аккаунт, чтобы увидеть корзину. <button class="back-shop-btn" onclick="showAuthPage()">Войти</button></p>';
        document.getElementById('cart-total').innerText = '0';
        document.getElementById('user-balance').innerText = '—';
        document.getElementById('my-orders').innerHTML = '<div class="empty-notice">Войдите, чтобы увидеть свои заявки.</div>';
        return;
    }
    refreshCart();
    loadMyOrders().then(renderMyOrders);
    refreshMe();
}

function showAdmin() {
    if (!currentUser || currentUser.role !== 'admin') {
        showHome();
        return;
    }
    hideAll();
    document.getElementById('admin-container').classList.remove('hidden');
    refreshAdmin();
}

function showAuthPage() {
    if (currentUser) {
        logout();
        return;
    }
    hideAll();
    document.getElementById('auth-container').classList.remove('hidden');
}

function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
    document.getElementById('auth-form').classList.toggle('hidden', !isLogin);
    document.getElementById('register-form').classList.toggle('hidden', isLogin);
}

/* ---------- аккаунт ---------- */

async function handleLogin(event) {
    event.preventDefault();
    const login = document.getElementById('login-input').value.trim();
    const password = document.getElementById('password-input').value;

    try {
        const { user } = await API.login(login, password);
        await afterLogin(user);
    } catch (err) {
        alert(err.message);
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    try {
        const { user } = await API.register(username, email, password);
        await afterLogin(user);
        notify('Аккаунт создан — теперь он есть в базе данных');
    } catch (err) {
        alert(err.message);
    }
}

async function afterLogin(user) {
    setUser(user);
    document.getElementById('auth-form').reset();
    document.getElementById('register-form').reset();
    switchAuthTab('login');
    await Promise.all([refreshCart(), loadFavorites()]);
    renderFavorites();
    updateCartCount();
    updateFavCount();
    if (user.role === 'admin') refreshPendingBadge();
    showShop();
}

async function logout() {
    try { await API.logout(); } catch (err) { /* не мешаем выходить */ }
    setUser(null);
    products.length && renderCatalog();
    showHome();
    notify('Вы вышли из аккаунта');
}

function setUser(user) {
    currentUser = user;

    const profileBtn = document.getElementById('profile-btn');
    profileBtn.innerText = user ? `Выйти (${user.username})` : 'Войти';

    document.getElementById('admin-icon-btn').classList.toggle('hidden', !user || user.role !== 'admin');

    if (!user) {
        cart = emptyCart();
        favorites = [];
        myOrders = [];
        renderCart();
        renderFavorites();
        renderMyOrders();
        updateCartCount();
        updateFavCount();
    }
    updateBalance();
}

async function refreshMe() {
    if (!currentUser) return;
    try {
        const { user } = await API.me();
        setUser(user);
    } catch (err) { /* игнорируем — просто не обновим баланс */ }
}

function updateBalance() {
    const el = document.getElementById('user-balance');
    if (el) el.innerText = currentUser ? money(currentUser.balance) : '—';
}

/* ---------- каталог ---------- */

async function loadProducts() {
    try {
        const data = await API.products.list();
        products = data.products;
    } catch (err) {
        products = [];
        notify('Не удалось загрузить каталог: ' + err.message, true);
    }
    renderCatalog();
}

function isFavorite(productId) {
    return favorites.some((item) => item.id === productId);
}

function renderCatalog() {
    const container = document.getElementById('catalog');
    if (!container) return;

    if (!products.length) {
        container.innerHTML = '<p>Товаров пока нет. Админ может добавить их в базе.</p>';
        return;
    }

    container.innerHTML = products.map((p) => `
        <div class="product-card">
            <div class="image-wrapper">
                <img class="tovar_img" src="${esc(p.image_url || '')}" alt="${esc(p.title)}">
                <button class="fav-heart-btn ${isFavorite(p.id) ? 'active' : ''}"
                        onclick="toggleFavorite(${p.id})" title="В избранное">
                    ${HEART_SVG}
                </button>
            </div>
            <h3 class="nazv_tovar">${esc(p.title)}</h3>
            <p class="price">${money(p.price)} ₽</p>
            <button type="button" onclick="addToCart(${p.id})" ${p.stock > 0 ? '' : 'disabled'}>
                ${p.stock > 0 ? 'В корзину' : 'Нет в наличии'}
            </button>
        </div>`).join('');
}

/* ---------- избранное ---------- */

async function loadFavorites() {
    if (!currentUser) {
        favorites = [];
        updateFavCount();
        return;
    }
    try {
        const data = await API.favorites.list();
        favorites = data.favorites;
    } catch (err) {
        favorites = [];
    }
    updateFavCount();
    renderCatalog();
}

function updateFavCount() {
    const el = document.getElementById('fav-count');
    if (el) el.innerText = favorites.length;
}

async function toggleFavorite(productId) {
    if (!currentUser) {
        showAuthPage();
        notify('Сначала войдите в аккаунт');
        return;
    }

    const wasFavorite = isFavorite(productId);
    try {
        if (wasFavorite) await API.favorites.remove(productId);
        else await API.favorites.add(productId);
        await loadFavorites();
        notify(wasFavorite ? 'Убрано из избранного' : 'Добавлено в избранное');
    } catch (err) {
        notify(err.message, true);
    }
}

function renderFavorites() {
    const container = document.getElementById('favorites-items');
    if (!container) return;

    if (!currentUser) {
        container.innerHTML = '<p>Войдите в аккаунт, чтобы увидеть избранное.</p>';
        return;
    }
    if (!favorites.length) {
        container.innerHTML = '<p>Список избранного пуст.</p>';
        return;
    }

    container.innerHTML = favorites.map((item) => `
        <div class="cart-item fav-item-row">
            <div class="cart-item-info">
                <span class="cart-item-title">${esc(item.title)}</span>
            </div>
            <div class="cart-item-info fav-actions">
                <span class="cart-item-price">${money(item.price)} ₽</span>
                <button class="add-to-cart-from-fav" onclick="addFromFavoritesToCart(${item.id})">В корзину</button>
                <button class="remove-item-btn" onclick="removeFromFavorites(${item.id})" title="Удалить">✕</button>
            </div>
        </div>`).join('');
}

async function removeFromFavorites(productId) {
    try {
        await API.favorites.remove(productId);
        await loadFavorites();
        renderFavorites();
    } catch (err) {
        notify(err.message, true);
    }
}

function addFromFavoritesToCart(productId) {
    addToCart(productId);
}

/* ---------- корзина ---------- */

async function refreshCart() {
    if (!currentUser) {
        cart = emptyCart();
        renderCart();
        return;
    }
    try {
        cart = await API.cart.get();
    } catch (err) {
        cart = emptyCart();
        notify(err.message, true);
    }
    renderCart();
}

function updateCartCount() {
    const el = document.getElementById('cart-count');
    if (el) el.innerText = cart.count;
}

async function addToCart(productId) {
    if (!currentUser) {
        showAuthPage();
        notify('Сначала войдите в аккаунт');
        return;
    }
    try {
        cart = await API.cart.add(productId, 1);
        updateCartCount();
        notify('Товар добавлен в корзину');
    } catch (err) {
        notify(err.message, true);
    }
}

function renderCart() {
    updateCartCount();
    updateBalance();

    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total');
    if (!container) return;

    if (totalEl) totalEl.innerText = money(cart.total);

    if (!cart.items.length) {
        container.innerHTML = '<p>Корзина пока пуста.</p>';
        return;
    }

    container.innerHTML = cart.items.map((item) => `
        <div class="cart-item">
            <div class="cart-item-info">
                <span class="cart-item-title">${esc(item.title)}</span>
                <span class="cart-item-qty">x${item.quantity}</span>
            </div>
            <div class="cart-item-info">
                <div class="qty-controls">
                    <button class="qty-btn" onclick="changeQuantity(${item.productId}, -1)">-</button>
                    <span>${item.quantity}</span>
                    <button class="qty-btn" onclick="changeQuantity(${item.productId}, 1)">+</button>
                </div>
                <span class="cart-item-price">${money(item.sum)} ₽</span>
                <button class="remove-item-btn" onclick="removeFromCart(${item.productId})" title="Удалить">✕</button>
            </div>
        </div>`).join('');
}

async function changeQuantity(productId, delta) {
    const item = cart.items.find((i) => i.productId === productId);
    if (!item) return;

    const nextQuantity = item.quantity + delta;
    try {
        if (nextQuantity <= 0) cart = await API.cart.remove(productId);
        else cart = await API.cart.setQuantity(productId, nextQuantity);
    } catch (err) {
        notify(err.message, true);
    }
    renderCart();
}

async function removeFromCart(productId) {
    try {
        cart = await API.cart.remove(productId);
        renderCart();
    } catch (err) {
        notify(err.message, true);
    }
}

/* ---------- запрос денег ---------- */

async function sendMoneyRequest() {
    const statusEl = document.getElementById('request-status');

    if (!currentUser) {
        showAuthPage();
        return;
    }

    const amount = Number(document.getElementById('request-amount').value);
    if (!amount || amount <= 0) {
        statusEl.style.color = '#c0392b';
        statusEl.innerText = 'Укажи сумму больше нуля.';
        return;
    }

    statusEl.style.color = '#555';
    statusEl.innerText = 'Отправляем запрос…';
    try {
        const { request } = await API.money.request(amount);
        statusEl.style.color = '#e67e22';
        statusEl.innerText = `Запрос №${request.id} на ${money(request.amount)} ₽ отправлен администратору. Ожидайте.`;
        loadMyOrders().then(renderMyOrders);
    } catch (err) {
        statusEl.style.color = '#c0392b';
        statusEl.innerText = err.message;
    }
}

/* ---------- оплата заказа ---------- */

async function checkoutOrder() {
    const statusEl = document.getElementById('checkout-status');

    if (!currentUser) {
        showAuthPage();
        return;
    }
    if (!cart.items.length) {
        statusEl.style.color = '#c0392b';
        statusEl.innerText = 'Корзина пуста.';
        return;
    }

    statusEl.style.color = '#555';
    statusEl.innerText = 'Отправляем заявку администратору…';

    try {
        const { order } = await API.checkout();
        statusEl.style.color = '#27ae60';
        statusEl.innerText = `Заявка №${order.id} на ${money(order.total)} ₽ отправлена. Админ примет или отклонит её.`;
        await refreshCart();
        await loadMyOrders();
        renderMyOrders();
        await refreshMe();
        if (currentUser && currentUser.role === 'admin') refreshPendingBadge();
    } catch (err) {
        statusEl.style.color = '#c0392b';
        statusEl.innerText = err.message;
    }
}

async function loadMyOrders() {
    if (!currentUser) {
        myOrders = [];
        return;
    }
    try {
        const data = await API.myOrders();
        myOrders = data.orders;
    } catch (err) {
        myOrders = [];
    }
}

function renderMyOrders() {
    const container = document.getElementById('my-orders');
    if (!container) return;

    if (!currentUser) {
        container.innerHTML = '<div class="empty-notice">Войдите, чтобы увидеть свои заявки.</div>';
        return;
    }
    if (!myOrders.length) {
        container.innerHTML = '<div class="empty-notice">Заявок пока нет.</div>';
        return;
    }

    container.innerHTML = myOrders.map((order) => `
        <div class="admin-req-card order-card">
            <div class="admin-req-info">
                <p><b>Заявка №${order.id}</b> · <span class="status-${order.status}">${STATUS_LABEL[order.status] || order.status}</span></p>
                <p class="order-items">${order.items.map((i) => `${esc(i.title)} × ${i.quantity}`).join(', ')}</p>
                <p class="order-sub">${esc(order.created_at)} · ${money(order.total)} ₽</p>
            </div>
        </div>`).join('');
}

/* ---------- админ-панель ---------- */

async function refreshAdmin() {
    updateAdminBadge();
    try {
        const [moneyData, ordersData] = await Promise.all([
            API.admin.moneyRequests('pending'),
            API.admin.orders('pending')
        ]);
        adminMoney = moneyData.requests;
        adminPayments = ordersData.orders;
    } catch (err) {
        notify(err.message, true);
        return;
    }
    renderAdminMoney();
    renderAdminPayments();
}

function renderAdminMoney() {
    const container = document.getElementById('admin-money-requests');
    if (!container) return;

    if (!adminMoney.length) {
        container.innerHTML = '<div class="empty-notice">(нет входящих запросов)</div>';
        return;
    }

    container.innerHTML = adminMoney.map((req) => `
        <div class="admin-req-card">
            <div class="admin-req-info">
                <p><b>${esc(req.username)}</b> запрашивает</p>
                <p style="font-size: 18px; font-weight: bold; color: #111;">${money(req.amount)} ₽</p>
                <p class="order-sub">${esc(req.created_at)} · баланс сейчас: ${money(req.balance)} ₽</p>
            </div>
            <div class="admin-req-actions">
                <button class="approve-btn" onclick="adminResolveMoney(${req.id}, true)">Выдать</button>
                <button class="reject-btn" onclick="adminResolveMoney(${req.id}, false)">Отказать</button>
            </div>
        </div>`).join('');
}

function renderAdminPayments() {
    const container = document.getElementById('admin-payment-requests');
    if (!container) return;

    if (!adminPayments.length) {
        container.innerHTML = '<div class="empty-notice">(нет входящих запросов)</div>';
        return;
    }

    container.innerHTML = adminPayments.map((order) => `
        <div class="admin-req-card">
            <div class="admin-req-info">
                <p><b>${esc(order.username)}</b> хочет оплатить заказ №${order.id} на сумму</p>
                <p style="font-size: 18px; font-weight: bold; color: #111;">${money(order.total)} ₽</p>
                <p class="order-items">${order.items.map((i) => `${esc(i.title)} × ${i.quantity}`).join(', ')}</p>
                <p class="order-sub">${esc(order.created_at)}</p>
            </div>
            <div class="admin-req-actions">
                <button class="approve-btn" onclick="adminResolvePayment(${order.id}, true)">Разрешить</button>
                <button class="reject-btn" onclick="adminResolvePayment(${order.id}, false)">Запретить</button>
            </div>
        </div>`).join('');
}

async function adminResolveMoney(id, approved) {
    try {
        if (approved) await API.admin.acceptMoney(id);
        else await API.admin.rejectMoney(id);
        notify(approved ? 'Деньги выданы' : 'В выдаче денег отказано');
        await refreshAdmin();
    } catch (err) {
        notify(err.message, true);
    }
}

async function adminResolvePayment(id, approved) {
    try {
        if (approved) await API.admin.accept(id);
        else await API.admin.reject(id);
        notify(approved ? 'Оплата разрешена — деньги списаны' : 'Оплата запрещена');
        await refreshAdmin();
    } catch (err) {
        notify(err.message, true);
    }
}

async function updateAdminBadge() {
    if (!currentUser || currentUser.role !== 'admin') return;

    try {
        const { total } = await API.admin.pendingCount();
        const badge = document.getElementById('admin-badge-count');
        if (total > 0) {
            badge.innerText = total;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    } catch (err) { /* тихо */ }
}

function refreshPendingBadge() {
    updateAdminBadge();
}

/* ---------- запуск ---------- */

(async function init() {
    try {
        const { user } = await API.me();
        setUser(user);
    } catch (err) {
        setUser(null);
        notify('Сервер недоступен: ' + err.message, true);
    }

    await loadProducts();

    if (currentUser) {
        await Promise.all([refreshCart(), loadFavorites()]);
        renderFavorites();
    }

    updateCartCount();
    updateFavCount();

    if (currentUser && currentUser.role === 'admin') {
        updateAdminBadge();
        setInterval(updateAdminBadge, 15000); // бейдж сам обновляется
    }
})();
