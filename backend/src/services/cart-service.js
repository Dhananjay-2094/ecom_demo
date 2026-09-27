const { randomUUID } = require('node:crypto');
const db = require('../db');
const { fail } = require('../lib/errors');
const { positiveInteger } = require('../lib/validate');

// Return a cart with current prices, item totals, available stock, and subtotal.
function getCart(cartId) {
  // Find the cart row first so a missing cart gets a clear API error.
  const cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId);
  if (!cart) fail(404, 'CART_NOT_FOUND', 'Cart was not found');
  // Join cart items to products to show current catalog details.
  const items = db.prepare(`SELECT ci.product_id AS productId, p.name, ci.quantity,
      p.unit_price_minor AS unitPriceMinor, ci.quantity * p.unit_price_minor AS lineTotalMinor,
      p.inventory AS availableInventory
    FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ? ORDER BY p.name`).all(cartId);
  // Add each line total to get the current cart subtotal.
  const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  // Return API field names rather than raw database column names.
  return { id: cart.id, status: cart.status, items, subtotalMinor, orderId: cart.order_id };
}

// Confirm that a cart exists and can still be edited.
function assertOpen(cartId) {
  // Read the cart state needed for edit validation.
  const cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId);
  // Stop if the supplied cart ID does not exist.
  if (!cart) fail(404, 'CART_NOT_FOUND', 'Cart was not found');
  // Prevent changing a cart after its order was placed.
  if (cart.status !== 'open') fail(409, 'CART_ALREADY_CHECKED_OUT', 'This cart has already been checked out', { orderId: cart.order_id });
}

// Create an empty cart and return its API representation.
function createCart() {
  // Generate a unique cart ID.
  const id = randomUUID();
  // Save the cart with the schema's default open status.
  db.prepare('INSERT INTO carts (id) VALUES (?)').run(id);
  // Reuse the normal cart reader to return a consistent response.
  return getCart(id);
}

// Add a product quantity, while checking the combined cart quantity against stock.
function addItem(cartId, productId, quantity) {
  // Reject zero, negative, decimal, or unsafe quantities before database work.
  positiveInteger(quantity);
  // Keep cart state, product stock, and item changes consistent during this update.
  const transaction = db.transaction(() => {
    // Do not allow edits on a missing or checked-out cart.
    assertOpen(cartId);
    // Only active products can be added to a cart.
    const product = db.prepare('SELECT id, inventory FROM products WHERE id = ? AND active = 1').get(productId);
    if (!product) fail(404, 'PRODUCT_NOT_FOUND', 'Active product was not found');
    // Include any quantity already in the cart before checking available stock.
    const current = db.prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cartId, productId);
    const requested = (current?.quantity || 0) + quantity;
    // Reject a cart quantity that is larger than the product's current stock.
    if (requested > product.inventory) {
      fail(409, 'INSUFFICIENT_INVENTORY', 'Requested cart quantity exceeds available inventory', {
        productId, available: product.inventory, currentQuantity: current?.quantity || 0, requested
      });
    }
    // Insert a new cart line or add to the existing line's quantity.
    db.prepare(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
      ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity`).run(cartId, productId, quantity);
  });
  // Commit the edit, then return the refreshed cart.
  transaction();
  return getCart(cartId);
}

// Set a cart line to an exact quantity after checking current stock.
function updateItem(cartId, productId, quantity) {
  // Validate the requested quantity before reading or writing the cart.
  positiveInteger(quantity);
  // Make the state check and quantity update one write transaction.
  const transaction = db.transaction(() => {
    // Require an editable cart.
    assertOpen(cartId);
    // Read the line and product stock together for the quantity check.
    const item = db.prepare(`SELECT ci.quantity, p.inventory, p.active FROM cart_items ci
      JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ? AND ci.product_id = ?`).get(cartId, productId);
    // Report a missing line or retired product as a missing editable cart item.
    if (!item || !item.active) fail(404, 'CART_ITEM_NOT_FOUND', 'Cart item or active product was not found');
    // Refuse a quantity that exceeds currently available stock.
    if (quantity > item.inventory) {
      fail(409, 'INSUFFICIENT_INVENTORY', 'Requested cart quantity exceeds available inventory', {
        productId, available: item.inventory, requested: quantity
      });
    }
    // Replace the line quantity; this endpoint sets rather than increments it.
    db.prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?').run(quantity, cartId, productId);
  });
  // Commit the change and return the refreshed cart.
  transaction();
  return getCart(cartId);
}

// Remove a product line from an open cart.
function removeItem(cartId, productId) {
  // Delete only after confirming the cart is still editable.
  const transaction = db.transaction(() => {
    assertOpen(cartId);
    // Remove this product's cart line.
    const result = db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(cartId, productId);
    // Distinguish a missing cart item from a successful delete.
    if (!result.changes) fail(404, 'CART_ITEM_NOT_FOUND', 'Cart item was not found');
  });
  // Commit the removal and return the remaining cart contents.
  transaction();
  return getCart(cartId);
}

module.exports = { getCart, createCart, addItem, updateItem, removeItem };
