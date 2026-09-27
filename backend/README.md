# Ecom API

Node.js REST API backed by a local SQLite database through Node's built-in `node:sqlite` module. Prices use integer minor units (for example, 1299 means 12.99 in the configured currency). Node currently labels this module a release candidate; see the official [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html).

## Run locally

1. Install Node.js 24.15.0 or later. 
2. In this directory, run `npm install`.
3. Copy `.env` and adjust the reward settings if desired.
4. Run `npm run dev` (or `npm start`). The service creates `data/store.sqlite`, applies the schema, and inserts the five starter products on startup. Stable seed IDs make this safe to repeat without adding duplicates.

Run the focused business-rule and concurrency tests with `npm test`.

The SQLite file, `.env`, and `node_modules` are intentionally ignored by Git. Reviewers recreate the schema and sample products by starting the service.

## Backend architecture

```text
├── ecom__backend/
│   ├── package.json             # API scripts and dependencies
│   ├── API_GUIDE.md             # Endpoints and request examples
│   ├── DECISIONS.md             # Backend decisions and trade-offs
│   ├── data/                    # Local SQLite file; not committed
│   ├── src/
│   │   ├── app.js               # Express setup and error handling
│   │   ├── server.js            # Loads environment and starts API
│   │   ├── db/
│   │   │   ├── index.js         # Opens SQLite, applies schema and seed
│   │   │   ├── schema.sql       # Tables, constraints, and indexes
│   │   │   └── seed.js          # Starter products
│   │   ├── lib/
│   │   │   ├── errors.js        # Shared API error handling
│   │   │   └── validate.js      # Shared input validation
│   │   ├── routes/              # HTTP endpoints by domain
│   │   └── services/            # Cart, checkout, and admin logic
│   └── test/
│       └── checkout-concurrency.test.js
```

## Endpoints

See [API_GUIDE.md](./API_GUIDE.md) for request bodies, examples, workflows, and error responses.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/products` | List active products |
| GET | `/api/products/:productId` | Read product |
| POST | `/api/admin/products` | **Admin:** create `{ "name", "unitPriceMinor", "inventory" }` |
| PATCH | `/api/admin/products/:productId` | **Admin:** update name and/or price |
| DELETE | `/api/admin/products/:productId` | **Admin:** retire product (soft delete) |
| POST | `/api/admin/products/:productId/inventory-adjustments` | **Admin:** adjust `{ "change": 10, "reason": "Restock" }`; negative changes remove stock |
| POST | `/api/carts` | Create cart |
| GET | `/api/carts/:cartId` | Read cart and current-price subtotal |
| POST | `/api/carts/:cartId/items` | Add `{ "productId", "quantity" }`; adding an existing product increases quantity |
| PATCH | `/api/carts/:cartId/items/:productId` | Set `{ "quantity" }` |
| DELETE | `/api/carts/:cartId/items/:productId` | Remove cart item |
| POST | `/api/carts/:cartId/checkout` | Checkout; send an `Idempotency-Key` header and optional `{ "couponCode" }` |
| GET | `/api/orders/:orderId` | Read immutable order details |
| POST | `/api/admin/coupons/generate` | **Admin:** issue coupon when an unrewarded order milestone is reached |
| GET | `/api/admin/coupons` | **Admin:** list coupon status |
| GET | `/api/admin/report` | **Admin:** order, revenue, quantity, and coupon summary |

Money fields in API responses are integer minor units. Errors use `{ "error": { "code", "message", "details"? } }`. Important codes include `INVALID_QUANTITY`, `CART_NOT_FOUND`, `CART_ALREADY_CHECKED_OUT`, `EMPTY_CART`, `INSUFFICIENT_INVENTORY`, `INVALID_COUPON`, `COUPON_ALREADY_REDEEMED`, and `IDEMPOTENCY_KEY_CONFLICT`.

## Current behavior and concurrency

Checkout validates and updates inventory, snapshots order lines, redeems an optional coupon, and marks the cart checked out in one SQLite transaction. The unique idempotency key and cart/order constraints protect retries and duplicate checkout. SQLite serializes writers; inventory updates also have a non-negative guard. Failed transactions roll back coupon and stock changes. 

The service treats checkout as successful payment; no payment provider is called. Cart reads display current prices. Checkout revalidates active status and current stock, prices with current product prices, and saves those prices and names in the order snapshot. A retired product in a cart blocks checkout. Coupon discounts are redeemable.

Admin routes are identified by their path only; authentication and authorization are intentionally out of scope.
