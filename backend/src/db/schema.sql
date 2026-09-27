PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  inventory INTEGER NOT NULL DEFAULT 0 CHECK (inventory >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'checked_out')),
  order_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_out_at TEXT
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL UNIQUE REFERENCES carts(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  coupon_id TEXT UNIQUE,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  milestone_order_count INTEGER NOT NULL UNIQUE,
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'redeemed')),
  redeemed_order_id TEXT UNIQUE REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT
);

-- Retain removed coupons so their milestone cannot be issued again and reporting stays auditable.
CREATE TABLE IF NOT EXISTS cancelled_coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  milestone_order_count INTEGER NOT NULL UNIQUE,
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  cancelled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);
