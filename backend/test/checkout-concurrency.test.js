const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-rewards-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');
process.env.REWARD_EVERY_N_ORDERS = '2';
process.env.REWARD_DISCOUNT_PERCENT = '10';

const app = require('../src/app');
const db = require('../src/db');
const server = app.listen(0);
const serverReady = once(server, 'listening');

const bottleId = '10000000-0000-4000-8000-000000000004';
const mugId = '10000000-0000-4000-8000-000000000001';
const lampId = '10000000-0000-4000-8000-000000000005';
const toteId = '10000000-0000-4000-8000-000000000002';

// Send a JSON request to the test server and return its status and response body.
async function request(route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json() };
}

// Create a fresh cart and add one product line for checkout scenarios.
async function createCartWithItem(productId, quantity = 1) {
  // Create the cart before attempting to add its product.
  const cartResponse = await request('/api/carts', { method: 'POST' });
  assert.equal(cartResponse.status, 201);
  const cartId = cartResponse.body.id;
  // Add the requested quantity and confirm the cart accepted it.
  const itemResponse = await request(`/api/carts/${cartId}/items`, {
    method: 'POST', body: { productId, quantity }
  });
  assert.equal(itemResponse.status, 201);
  return cartId;
}

// Exercise the checkout invariants through overlapping HTTP requests.
test('checkout invariants hold for concurrent and repeated requests', async (t) => {
  await serverReady;
  // Close the test server and remove its isolated temporary database afterward.
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Cart edits must reject quantities larger than current stock.
  await t.test('cart quantity cannot exceed current inventory', async () => {
    const cart = await request('/api/carts', { method: 'POST' });
    const result = await request(`/api/carts/${cart.body.id}/items`, {
      method: 'POST', body: { productId: bottleId, quantity: 4 }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'INSUFFICIENT_INVENTORY');
  });

  // Two carts competing for more units than remain must not oversell.
  await t.test('competing checkouts cannot oversell limited stock', async () => {
    const cartA = await createCartWithItem(bottleId, 2);
    const cartB = await createCartWithItem(bottleId, 2);
    const [a, b] = await Promise.all([
      request(`/api/carts/${cartA}/checkout`, { method: 'POST', headers: { 'Idempotency-Key': 'limited-stock-a-001' }, body: {} }),
      request(`/api/carts/${cartB}/checkout`, { method: 'POST', headers: { 'Idempotency-Key': 'limited-stock-b-001' }, body: {} })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const rejected = a.status === 409 ? a : b;
    assert.equal(rejected.body.error.code, 'INSUFFICIENT_INVENTORY');
    const products = await request('/api/products');
    assert.equal(products.body.products.find((product) => product.id === bottleId).inventory, 1);
  });

  // Retrying the same checkout key must return one order and take stock once.
  await t.test('repeating checkout with the same key returns one order and decrements once', async () => {
    const cartId = await createCartWithItem(mugId, 2);
    const checkout = () => request(`/api/carts/${cartId}/checkout`, {
      method: 'POST', headers: { 'Idempotency-Key': 'retry-same-cart-key-001' }, body: {}
    });
    const [first, retry] = await Promise.all([checkout(), checkout()]);
    assert.equal(first.status, 201);
    assert.equal(retry.status, 201);
    assert.equal(first.body.id, retry.body.id);
    assert.equal((await request('/api/products')).body.products.find((product) => product.id === mugId).inventory, 98);
  });

  // A checkout failure must leave the supplied coupon available.
  await t.test('failed checkout leaves its coupon available', async () => {
    const couponResponse = await request('/api/admin/coupons/generate', { method: 'POST' });
    assert.equal(couponResponse.status, 201);
    const code = couponResponse.body.code;
    const cartId = await createCartWithItem(lampId, 1);
    const retired = await request(`/api/admin/products/${lampId}`, { method: 'DELETE' });
    assert.equal(retired.status, 200);
    const failed = await request(`/api/carts/${cartId}/checkout`, {
      method: 'POST', headers: { 'Idempotency-Key': 'failed-cart-coupon-001' }, body: { couponCode: code }
    });
    assert.equal(failed.status, 409);
    assert.equal(failed.body.error.code, 'PRODUCT_RETIRED');
    const coupons = await request('/api/admin/coupons');
    assert.equal(coupons.body.coupons.find((coupon) => coupon.code === code).status, 'available');
  });

  // Two overlapping checkouts cannot both redeem one coupon.
  await t.test('two checkouts cannot redeem the same coupon', async () => {
    const coupons = await request('/api/admin/coupons');
    const code = coupons.body.coupons.find((coupon) => coupon.status === 'available').code;
    const cartA = await createCartWithItem(toteId, 1);
    const cartB = await createCartWithItem(toteId, 1);
    const [a, b] = await Promise.all([
      request(`/api/carts/${cartA}/checkout`, { method: 'POST', headers: { 'Idempotency-Key': 'coupon-race-cart-a-01' }, body: { couponCode: code } }),
      request(`/api/carts/${cartB}/checkout`, { method: 'POST', headers: { 'Idempotency-Key': 'coupon-race-cart-b-01' }, body: { couponCode: code } })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const rejected = a.status === 409 ? a : b;
    assert.equal(rejected.body.error.code, 'COUPON_ALREADY_REDEEMED');
    const finalCoupon = (await request('/api/admin/coupons')).body.coupons.find((coupon) => coupon.code === code);
    assert.equal(finalCoupon.status, 'redeemed');
  });
});
