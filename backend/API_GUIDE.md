# API guide

This guide covers the backend as currently implemented. The API is JSON over HTTP. Start the server from `ecom__backend/` with `npm run dev`; the base URL is `http://localhost:3000`. There is no Angular UI yet, so open these API URLs with an API client (PowerShell, curl, Postman, etc.), not as browser pages.

Admin routes are under `/api/admin`. Authentication is intentionally not implemented, so these routes are not protected.

## 1. Start the service and get starter products

Install dependencies and start the server:

```powershell
cd ecom__backend
npm install
npm run dev
```

On startup, the service creates the SQLite file at `data/store.sqlite`, applies `src/db/schema.sql`, and inserts five starter products. Stable IDs mean restarting the service does not add duplicates. The limited-stock seeded item is Insulated Bottle (inventory 3).

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost:3000/api/products
```

Prices are integer minor units: `1299` means 12.99 in the configured currency. Product responses include `id`, `name`, `unitPriceMinor`, `inventory`, and `active`.

## 2. Products and inventory

### List active products

```http
GET /api/products
```

Returns `200` and `{ "products": [...] }`.

### Get one product

```http
GET /api/products/{productId}
```

Returns `200` and a product object, including a retired product if its ID exists. Returns `404 PRODUCT_NOT_FOUND` for an unknown ID.

### Admin: list products (including retired)

```http
GET /api/admin/products
```

Returns `200` and `{ "products": [...] }`. This includes retired products so the admin can inspect the catalog.

### Admin: create product

```http
POST /api/admin/products
Content-Type: application/json
```

Body:

```json
{
  "name": "Travel Cup",
  "unitPriceMinor": 1599,
  "inventory": 20
}
```

Returns `201` and the created product. `name` must be a non-empty string; `unitPriceMinor` and `inventory` must be non-negative integers.

### Admin: update product name and/or price

```http
PATCH /api/admin/products/{productId}
Content-Type: application/json
```

Send one or both fields:

```json
{
  "name": "Travel Cup - Blue",
  "unitPriceMinor": 1699
}
```

Returns `200` and the updated product. Inventory is deliberately changed through the adjustment route below, not this endpoint.

### Admin: retire a product

```http
DELETE /api/admin/products/{productId}
```

Returns `200` and `{ "id": "...", "active": false }`. This is a soft delete: it disappears from the public product list and cannot be newly added to a cart, while order history remains intact. A cart containing a retired product cannot be checked out.

### Admin: add or remove inventory

```http
POST /api/admin/products/{productId}/inventory-adjustments
Content-Type: application/json
```

Add stock:

```json
{
  "change": 10,
  "reason": "Restock"
}
```

Remove stock by using a negative change:

```json
{
  "change": -2,
  "reason": "Damaged units"
}
```

Returns `200` and the updated product, plus the adjustment. A zero or non-integer change is rejected; an adjustment that would take inventory below zero returns `409 INSUFFICIENT_INVENTORY`.

## 3. Carts

### Create a cart

```http
POST /api/carts
```

No body. Returns `201` and an empty cart with its generated `id`.

### View a cart

```http
GET /api/carts/{cartId}
```

Returns `200` with `id`, `status`, `items`, `subtotalMinor`, and `orderId`. Cart display uses current product prices. An item includes `productId`, `name`, `quantity`, `unitPriceMinor`, `lineTotalMinor`, and current `availableInventory`.

### Add an item

```http
POST /api/carts/{cartId}/items
Content-Type: application/json
```

```json
{
  "productId": "10000000-0000-4000-8000-000000000004",
  "quantity": 2
}
```

Returns `201` and the updated cart. Adding the same product again increases the cart quantity. Product must be active; quantity must be a positive integer; the combined cart quantity cannot exceed current available inventory (`409 INSUFFICIENT_INVENTORY`). Cart changes do not reserve inventory, so checkout rechecks stock in case it changed afterward.

### Set an item quantity

```http
PATCH /api/carts/{cartId}/items/{productId}
Content-Type: application/json
```

```json
{
  "quantity": 1
}
```

Returns `200` and the updated cart. This sets the quantity (it does not increment it); the requested quantity cannot exceed current available inventory (`409 INSUFFICIENT_INVENTORY`). Checkout rechecks stock in case it changed after the cart update.

### Remove an item

```http
DELETE /api/carts/{cartId}/items/{productId}
```

Returns `200` and the updated cart. A missing cart returns `404 CART_NOT_FOUND`; a missing item returns `404 CART_ITEM_NOT_FOUND`. Cart edits after checkout return `409 CART_ALREADY_CHECKED_OUT`.

## 4. Checkout and orders

### Check out a cart

```http
POST /api/carts/{cartId}/checkout
Idempotency-Key: checkout-cart-123-attempt-1
Content-Type: application/json
```

Without coupon:

```json
{}
```

With coupon:

```json
{
  "couponCode": "SAVE10-AB12CD34"
}
```

`Idempotency-Key` is required and must be at least 8 characters. Returns `201` and the order on first success. Repeating the same key for the same cart returns the same order; using that key for another cart returns `409 IDEMPOTENCY_KEY_CONFLICT`. A cart can only produce one order.

Checkout rechecks product status and stock, uses current prices, and stores product name, unit price, quantity, and line total snapshots on the order. Inventory decrement, order creation, coupon redemption, and cart closure commit in one SQLite transaction. Failed checkout does not consume stock or coupon. Checkout is treated as successful payment; there is no payment provider.

### Get an order

```http
GET /api/orders/{orderId}
```

Returns `200` with order ID, cart ID, idempotency key, coupon code (if used), item snapshots, `subtotalMinor`, `discountMinor`, `totalMinor`, and `createdAt`. Returns `404 ORDER_NOT_FOUND` when absent.

## 5. Coupons and rewards

Reward settings are in `.env`:

```dotenv
REWARD_EVERY_N_ORDERS=5
REWARD_DISCOUNT_PERCENT=10
```

With these values, the system can generate one 10% coupon after order 5, order 10, and so on. Successful order count determines eligibility. The admin explicitly requests generation; it is not generated automatically during checkout.

### Admin: generate eligible coupon

```http
POST /api/admin/coupons/generate
```

No body. Returns `201` with coupon code, milestone order count, discount percent, and `available` status. Returns `409 MILESTONE_NOT_REACHED` before the first milestone, or `409 COUPON_ALREADY_GENERATED` if a coupon already exists for the latest eligible milestone.

### Admin: list coupons

```http
GET /api/admin/coupons
```

Returns `200` and `{ "coupons": [...] }`, including code, milestone, discount percent, status, redeemed order ID, and timestamps.

### Admin: remove an available coupon

```http
DELETE /api/admin/coupons/{couponCode}
```

No body. This cancels an unused coupon and returns `200` with its code, milestone, and `cancelled` status. It is retained in coupon history and reporting, and its milestone cannot be generated again. Returns `404 COUPON_NOT_FOUND` if unknown, `409 COUPON_ALREADY_CANCELLED` if already removed, or `409 COUPON_ALREADY_REDEEMED` if it has already been used.

Coupons apply to the full subtotal, can be redeemed once, and are redeemed atomically with checkout. Available coupons may be cancelled by an administrator. Discount rounds to the nearest minor unit (half up) and cannot exceed the subtotal.

## 6. Admin report

```http
GET /api/admin/report
```

No body. Returns `200`, for example:

```json
{
  "totalOrders": 5,
  "quantityByProduct": [
    { "productId": "...", "productName": "Everyday Mug", "quantity": 3 }
  ],
  "grossRevenueMinor": 3897,
  "totalDiscountsMinor": 390,
  "netRevenueMinor": 3507,
  "coupons": {
    "generated": 1,
    "available": 1,
    "redeemed": 0
  }
}
```

Revenue values are integer minor units and reconcile to successful orders. The report is read-only.

## 7. Common errors

Errors have this shape:

```json
{
  "error": {
    "code": "INSUFFICIENT_INVENTORY",
    "message": "Insufficient inventory for an item",
    "details": { "productId": "...", "available": 1, "requested": 2 }
  }
}
```

Common status codes: `400` invalid input, empty cart, missing idempotency key, or invalid coupon; `404` missing cart/product/order/route; `409` inventory shortage, retired product, already checked-out cart, already-redeemed coupon, idempotency conflict, or coupon milestone not eligible/already generated; `500` unexpected server error.

## 8. Concurrency and local database

The service uses a SQLite transaction for checkout and inventory adjustment. SQLite serializes writes, and database constraints plus checkout idempotency protect the important invariants. This is intended for a single local service/database file.

Run the focused concurrency and failure-mode suite with `npm test` from the `test` directory.
