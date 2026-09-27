const { randomUUID } = require('node:crypto');
const db = require('../db');
const { fail } = require('../lib/errors');

// Place an order once for a cart, optionally applying a coupon.
function checkout(cartId, idempotencyKey, couponCode) {
  // Require a stable key so clients can safely retry after a timeout.
  if (!idempotencyKey || idempotencyKey.trim().length < 8) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header of at least 8 characters');
  // Return the saved order if this request key already completed for this cart.
  const existing = db.prepare('SELECT id, cart_id FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) {
    // Prevent a client from reusing the same key for another cart.
    if (existing.cart_id !== cartId) fail(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This idempotency key belongs to another cart');
    return getOrder(existing.id);
  }

  // Prepare the ID for the order that will be inserted if checkout succeeds.
  const orderId = randomUUID();
  // Keep stock, order, coupon, and cart state changes all-or-nothing.
  const transaction = db.transaction(() => {
    // Recheck the key after obtaining the write lock for overlapping requests.
    const prior = db.prepare('SELECT id, cart_id FROM orders WHERE idempotency_key = ?').get(idempotencyKey);
    if (prior) {
      // Reject a key already claimed by a different cart.
      if (prior.cart_id !== cartId) fail(409, 'IDEMPOTENCY_KEY_CONFLICT', 'This idempotency key belongs to another cart');
      return prior.id;
    }
    // Load the cart state while holding the write transaction.
    const cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId);
    // Reject an unknown cart.
    if (!cart) fail(404, 'CART_NOT_FOUND', 'Cart was not found');
    // Prevent a cart from producing a second order.
    if (cart.status !== 'open') fail(409, 'CART_ALREADY_CHECKED_OUT', 'This cart has already been checked out', { orderId: cart.order_id });
    // Read cart lines alongside current product price, active state, and stock.
    const items = db.prepare(`SELECT ci.product_id, ci.quantity, p.name, p.unit_price_minor, p.inventory, p.active
      FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ?`).all(cartId);
    // An empty cart cannot become an order.
    if (!items.length) fail(400, 'EMPTY_CART', 'Cannot check out an empty cart');
    // Validate every product before making any checkout writes.
    for (const item of items) {
      if (!item.active) fail(409, 'PRODUCT_RETIRED', 'Cart contains a retired product', { productId: item.product_id });
      if (item.inventory < item.quantity) fail(409, 'INSUFFICIENT_INVENTORY', 'Insufficient inventory for an item', { productId: item.product_id, available: item.inventory, requested: item.quantity });
    }
    // Calculate the pre-discount total from current unit prices.
    const subtotal = items.reduce((sum, item) => sum + item.unit_price_minor * item.quantity, 0);
    let coupon = null;
    let discount = 0;
    if (couponCode) {
      // Find the supplied coupon and require it to still be available.
      coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(couponCode.trim().toUpperCase());
      if (!coupon) fail(400, 'INVALID_COUPON', 'Coupon code is not valid');
      if (coupon.status !== 'available') fail(409, 'COUPON_ALREADY_REDEEMED', 'Coupon has already been redeemed');
      // Apply half-up integer rounding and never discount more than the subtotal.
      discount = Math.min(subtotal, Math.floor((subtotal * coupon.discount_percent + 50) / 100));
    }
    // Save the order header and calculated totals.
    db.prepare(`INSERT INTO orders (id, cart_id, idempotency_key, coupon_id, subtotal_minor, discount_minor, total_minor)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(orderId, cartId, idempotencyKey, coupon?.id || null, subtotal, discount, subtotal - discount);
    const insertLine = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_price_minor, quantity, line_total_minor)
      VALUES (?, ?, ?, ?, ?, ?)`);
    // Decrement only when stock still covers the requested quantity.
    const decrement = db.prepare('UPDATE products SET inventory = inventory - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND inventory >= ?');
    // Save each purchased item snapshot and reduce its inventory.
    for (const item of items) {
      const changed = decrement.run(item.quantity, item.product_id, item.quantity);
      if (!changed.changes) fail(409, 'INSUFFICIENT_INVENTORY', 'Inventory changed during checkout', { productId: item.product_id });
      insertLine.run(orderId, item.product_id, item.name, item.unit_price_minor, item.quantity, item.unit_price_minor * item.quantity);
    }
    // Mark the coupon redeemed as part of the same order transaction.
    if (coupon) db.prepare(`UPDATE coupons SET status = 'redeemed', redeemed_order_id = ?, redeemed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'available'`).run(orderId, coupon.id);
    // Close the cart and link it to the newly created order.
    db.prepare(`UPDATE carts SET status = 'checked_out', order_id = ?, checked_out_at = CURRENT_TIMESTAMP WHERE id = ?`).run(orderId, cartId);
    return orderId;
  });
  // Commit checkout before loading the saved order response.
  return getOrder(transaction());
}

// Read an order and return its stored product and price snapshots.
function getOrder(orderId) {
  // Load order totals and the coupon code, if this order used a coupon.
  const order = db.prepare(`SELECT o.*, c.code AS coupon_code FROM orders o LEFT JOIN coupons c ON c.id = o.coupon_id WHERE o.id = ?`).get(orderId);
  // Return a clear error when the order ID does not exist.
  if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order was not found');
  // Load the saved order lines rather than reading current product data.
  const items = db.prepare(`SELECT product_id AS productId, product_name AS name, unit_price_minor AS unitPriceMinor,
    quantity, line_total_minor AS lineTotalMinor FROM order_items WHERE order_id = ?`).all(orderId);
  // Return a stable API response from the saved order data.
  return { id: order.id, cartId: order.cart_id, idempotencyKey: order.idempotency_key, couponCode: order.coupon_code,
    items, subtotalMinor: order.subtotal_minor, discountMinor: order.discount_minor, totalMinor: order.total_minor, createdAt: order.created_at };
}

module.exports = { checkout, getOrder };
