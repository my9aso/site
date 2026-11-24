-- ---------------------------------------------------------------
-- Структура таблиц базы данных магазина.
-- База уже создана на сервере (MySQL 8.0), файл показывает,
-- из каких таблиц она состоит.
-- ---------------------------------------------------------------

-- Пользователи сайта (обычные и админы)
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(32)  NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password      VARCHAR(100) NOT NULL,          -- пароль в открытом виде (для учебного проекта)
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  balance       DECIMAL(10,2) NOT NULL DEFAULT 5000.00,  -- баланс, как на сайте
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_users_username (username),
  UNIQUE KEY uniq_users_email (email)
) ENGINE=InnoDB;

-- Товары каталога
CREATE TABLE IF NOT EXISTS products (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(190) NOT NULL,
  description TEXT NULL,
  price       DECIMAL(10,2) NOT NULL DEFAULT 0,
  image_url   VARCHAR(500) NULL,
  stock       INT NOT NULL DEFAULT 0,           -- сколько штук есть
  is_active   TINYINT(1) NOT NULL DEFAULT 1,    -- 0 = скрыт из каталога
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_active (is_active)
) ENGINE=InnoDB;

-- Корзина: что пользователь положил, но ещё не оформил
CREATE TABLE IF NOT EXISTS cart_items (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  quantity   INT NOT NULL DEFAULT 1,
  added_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_cart_user_product (user_id, product_id),
  KEY idx_cart_user (user_id),
  CONSTRAINT fk_cart_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Избранное (сердечко на карточке товара)
CREATE TABLE IF NOT EXISTS favorites (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_fav_user_product (user_id, product_id),
  CONSTRAINT fk_fav_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_fav_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Запросы на выдачу денег: пользователь просит сумму -> админ выдаёт/отказывает
CREATE TABLE IF NOT EXISTS money_requests (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  amount     DECIMAL(10,2) NOT NULL,
  status     ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  decided_by INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_money_status (status),
  KEY idx_money_user (user_id),
  CONSTRAINT fk_money_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_money_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Заявки на покупку: пользователь нажал "Оформить" -> админ принимает/отклоняет
CREATE TABLE IF NOT EXISTS orders (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  status     ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  total      DECIMAL(10,2) NOT NULL DEFAULT 0,
  comment    VARCHAR(500) NULL,                 -- необязательный комментарий покупателя
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,                     -- когда админ принял решение
  decided_by INT UNSIGNED NULL,                 -- какой админ решил
  PRIMARY KEY (id),
  KEY idx_orders_status (status),
  KEY idx_orders_user (user_id),
  CONSTRAINT fk_orders_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_orders_decider FOREIGN KEY (decided_by) REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB;

-- Состав заявки. Название и цена сохраняются копией: если товар подорожает
-- или будет удалён, история заявки останется правильной.
CREATE TABLE IF NOT EXISTS order_items (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id   INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NULL,
  title      VARCHAR(190) NOT NULL,
  price      DECIMAL(10,2) NOT NULL,
  quantity   INT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_items_order (order_id),
  CONSTRAINT fk_items_order   FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB;
