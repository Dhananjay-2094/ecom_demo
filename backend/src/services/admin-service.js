const { randomUUID, randomBytes } = require('node:crypto');
const db = require('../db');
const { fail } = require('../lib/errors');
const { requiredString } = require('../lib/validate');

// List products, optionally including products retired from the storefront.
function listProducts(includeRetired = false) {
  // Select only the fields shown by the catalog API.
  return db.prepare(`SELECT id, name, unit_price_minor AS unitPriceMinor, inventory, active
    FROM products ${includeRetired ? '' : 'WHERE active = 1'} ORDER BY name`).all();
}

// Validate and save a new product.
function createProduct(input) {
  // Clean the product name and validate its integer price and stock.
  const name = requiredString(input.name, 'name');
  if (!Number.isSafeInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) fail(400, 'INVALID_PRICE', 'unitPriceMinor must be a non-negative integer in minor currency units');
  if (!Number.isSafeInteger(input.inventory) || input.inventory < 0) fail(400, 'INVALID_INVENTORY', 'inventory must be a non-negative integer');
  // Give the product a stable unique identifier.
  const id = randomUUID();
  // Save the new product using money in minor units.
  db.prepare('INSERT INTO products (id, name, unit_price_minor, inventory) VALUES (?, ?, ?, ?)').run(id, name, input.unitPriceMinor, input.inventory);
  // Return the same shape used by product lookup.
  return getProduct(id);
}

// Look up a product, including one that has been retired.
function getProduct(id) {
  // Read the API fields for this product ID.
  const product = db.prepare(`SELECT id, name, unit_price_minor AS unitPriceMinor, inventory, active
    FROM products WHERE id = ?`).get(id);
  // Report unknown product IDs to the API caller.
  if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found');
  return product;
}

// Update a product's name and/or unit price without changing its inventory.
function updateProduct(id, input) {
  // Load the current values so omitted fields remain unchanged.
  const current = getProduct(id);
  const name = input.name === undefined ? current.name : requiredString(input.name, 'name');
  const price = input.unitPriceMinor === undefined ? current.unitPriceMinor : input.unitPriceMinor;
  // Reject invalid prices before updating the product row.
  if (!Number.isSafeInteger(price) || price < 0) fail(400, 'INVALID_PRICE', 'unitPriceMinor must be a non-negative integer in minor currency units');
  // Save the changed catalog fields and record the edit time.
  db.prepare(`UPDATE products SET name = ?, unit_price_minor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(name, price, id);
  // Return the updated product.
  return getProduct(id);
}

// Retire a product so it is no longer sold but stays available for history.
function retireProduct(id) {
  // Change only an active product and record when it was updated.
  const result = db.prepare(`UPDATE products SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND active = 1`).run(id);
  // Treat unknown and already-retired product IDs as not found for this action.
  if (!result.changes) fail(404, 'PRODUCT_NOT_FOUND', 'Active product was not found');
  return { id, active: false };
}

// Apply a signed stock change without allowing inventory below zero.
function adjustInventory(id, change, reason) {
  // Require an integer change that actually adds or removes stock.
  if (!Number.isSafeInteger(change) || change === 0) fail(400, 'INVALID_INVENTORY_CHANGE', 'change must be a non-zero integer');
  // Require a reason so the admin action has useful context in its response.
  const why = requiredString(reason, 'reason');
  // Read and update stock in one transaction so overlapping adjustments cannot overwrite each other.
  const transaction = db.transaction(() => {
    // Read the latest inventory while holding SQLite's write transaction.
    const product = db.prepare('SELECT inventory FROM products WHERE id = ?').get(id);
    // Reject an unknown product ID.
    if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Product was not found');
    const updated = product.inventory + change;
    // Prevent a removal from making inventory negative.
    if (updated < 0) fail(409, 'INSUFFICIENT_INVENTORY', 'Adjustment would make inventory negative', { available: product.inventory, change });
    // Save the new stock count and update timestamp.
    db.prepare('UPDATE products SET inventory = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(updated, id);
  });
  // Commit the stock change and return the result with its reason.
  transaction();
  return { ...getProduct(id), adjustment: { change, reason: why } };
}

// Generate one coupon for the latest eligible order milestone.
function generateCoupon() {
  // Read and validate reward settings, using defaults when none are configured.
  const n = Number(process.env.REWARD_EVERY_N_ORDERS || 5);
  const x = Number(process.env.REWARD_DISCOUNT_PERCENT || 10);
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(x) || x < 1 || x > 100) fail(500, 'INVALID_REWARD_CONFIG', 'Reward configuration must use a positive milestone and discount from 1 to 100');
  // Check eligibility and insert the coupon inside one write transaction.
  const transaction = db.transaction(() => {
    // Count only successfully created orders.
    const count = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    const milestone = Math.floor(count / n) * n;
    // Require at least one complete milestone.
    if (milestone < n) fail(409, 'MILESTONE_NOT_REACHED', 'No reward milestone has been reached yet', { orders: count, nextMilestone: n });
    // Check both active and cancelled coupon history to avoid repeating a milestone.
    const prior = db.prepare('SELECT code FROM coupons WHERE milestone_order_count = ?').get(milestone);
    const cancelled = db.prepare('SELECT code FROM cancelled_coupons WHERE milestone_order_count = ?').get(milestone);
    if (prior || cancelled) fail(409, 'COUPON_ALREADY_GENERATED', 'Coupon already exists for the latest eligible milestone', { milestone, code: prior?.code || cancelled.code });
    // Create a new unique code for this milestone.
    const code = `SAVE${x}-${randomBytes(4).toString('hex').toUpperCase()}`;
    // Store the coupon as available for checkout.
    db.prepare(`INSERT INTO coupons (id, code, milestone_order_count, discount_percent) VALUES (?, ?, ?, ?)`).run(randomUUID(), code, milestone, x);
    return { code, milestoneOrderCount: milestone, discountPercent: x, status: 'available' };
  });
  // Commit coupon creation and return its details.
  return transaction();
}

// Return active and cancelled coupons in milestone order.
function listCoupons() {
  // Load coupons that can be available or have been redeemed.
  const active = db.prepare(`SELECT code, milestone_order_count AS milestoneOrderCount, discount_percent AS discountPercent,
    status, redeemed_order_id AS redeemedOrderId, created_at AS createdAt, redeemed_at AS redeemedAt
    FROM coupons`).all();
  // Load removed coupons with a cancelled status for history and reporting.
  const cancelled = db.prepare(`SELECT code, milestone_order_count AS milestoneOrderCount, discount_percent AS discountPercent,
    'cancelled' AS status, NULL AS redeemedOrderId, NULL AS createdAt, NULL AS redeemedAt, cancelled_at AS cancelledAt
    FROM cancelled_coupons`).all();
  // Combine both coupon states and sort them by the order milestone.
  return [...active, ...cancelled].sort((a, b) => a.milestoneOrderCount - b.milestoneOrderCount);
}

// Cancel an unused coupon while retaining its code and milestone history.
function cancelCoupon(code) {
  // Move the coupon to its history table and remove it from redeemable coupons atomically.
  const transaction = db.transaction(() => {
    // Normalize the supplied code before looking it up.
    const coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(code.trim().toUpperCase());
    if (!coupon) {
      // Distinguish a coupon already cancelled from a code that never existed.
      const cancelled = db.prepare('SELECT code FROM cancelled_coupons WHERE code = ?').get(code.trim().toUpperCase());
      if (cancelled) fail(409, 'COUPON_ALREADY_CANCELLED', 'Coupon has already been cancelled');
      fail(404, 'COUPON_NOT_FOUND', 'Coupon was not found');
    }
    // Keep redeemed coupons tied to the order that used them.
    if (coupon.status === 'redeemed') fail(409, 'COUPON_ALREADY_REDEEMED', 'A redeemed coupon cannot be removed');
    // Save a cancellation record so the milestone cannot be issued again.
    db.prepare(`INSERT INTO cancelled_coupons (id, code, milestone_order_count, discount_percent)
      VALUES (?, ?, ?, ?)`).run(coupon.id, coupon.code, coupon.milestone_order_count, coupon.discount_percent);
    // Remove the code from the set of coupons that checkout may redeem.
    db.prepare('DELETE FROM coupons WHERE id = ?').run(coupon.id);
    return { code: coupon.code, milestoneOrderCount: coupon.milestone_order_count, status: 'cancelled' };
  });
  // Commit cancellation and return the new coupon status.
  return transaction();
}

// Build the admin summary without changing stored state.
function report() {
  // Sum successful order counts and money totals from saved orders.
  const orders = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(subtotal_minor), 0) AS gross, COALESCE(SUM(discount_minor), 0) AS discounts, COALESCE(SUM(total_minor), 0) AS net FROM orders').get();
  // Sum purchased quantities from saved order lines grouped by product/name snapshot.
  const quantityByProduct = db.prepare(`SELECT oi.product_id AS productId, oi.product_name AS productName, SUM(oi.quantity) AS quantity
    FROM order_items oi GROUP BY oi.product_id, oi.product_name ORDER BY oi.product_name`).all();
  // Count coupons that remain in the active coupon table by their status.
  const coupons = db.prepare(`SELECT COUNT(*) AS generated, SUM(status = 'available') AS available,
    SUM(status = 'redeemed') AS redeemed FROM coupons`).get();
  // Count cancelled coupons separately so total generated includes coupon history.
  const cancelledCount = db.prepare('SELECT COUNT(*) AS count FROM cancelled_coupons').get().count;
  // Return revenue and coupon counts in the API's camelCase format.
  return { totalOrders: orders.count, quantityByProduct, grossRevenueMinor: orders.gross,
    totalDiscountsMinor: orders.discounts, netRevenueMinor: orders.net,
    coupons: { generated: coupons.generated + cancelledCount, available: coupons.available || 0,
      redeemed: coupons.redeemed || 0, cancelled: cancelledCount } };
}

module.exports = { listProducts, createProduct, getProduct, updateProduct, retireProduct, adjustInventory, generateCoupon, listCoupons, cancelCoupon, report };
