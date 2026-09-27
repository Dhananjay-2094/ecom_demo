# Design decisions

## What this service does

This is a Node.js API backed by a local SQLite database file. It supports products, carts, checkout, coupons, and reporting. The API treats a successful checkout as a successful payment. There is no payment provider.

Admin routes are marked in the API paths and guide. They are not protected by login because authentication is outside the assignment's scope.

See [API_GUIDE.md](./API_GUIDE.md) for endpoint examples. Run the focused tests with `npm test` from the `ecom__backend/` folder.

## Rules that must always hold

These rules must remain true when requests fail, repeat, or overlap:

1. **Stock cannot go below zero.** Adding or changing a cart item checks stock. Checkout checks it again before taking stock.
2. **A cart can create only one order.** After checkout succeeds, the cart is closed.
3. **A retry cannot create a second order or take stock twice.** The same idempotency key and cart return the original order.
4. **A coupon can be used only once.** Only one successful order can use it.
5. **Failed checkout changes nothing.** It must not leave a partial order, reduce stock, use a coupon, or close the cart.
6. **An order explains what was bought.** It saves the product name and price, quantity, line total, subtotal, discount, and final total.
7. **Reports do not change data.** Their totals come from completed orders and saved order lines.
8. **A milestone can have only one coupon.** Cancelling that coupon does not make the milestone available again.

Tests cover competing checkouts for limited stock, a repeated checkout, two checkouts using one coupon, a failed checkout with a coupon, and cart quantity limits. This is useful coverage, but it does not test every possible failure.

## Unclear parts of the brief and the choices made

- **Does a cart reserve stock?** No. Cart changes check current stock, but do not hold it. Another customer may buy those units before checkout. Checkout checks again and can fail if stock has run out.
- **What if the price changes after a product is added to a cart?** The cart shows the current price. Checkout uses the current price and saves it on the order.
- **What if several reward milestones pass before an admin creates a coupon?** The API creates a coupon for the latest reached milestone only. Older missed milestones are not filled in later.
- **What does a coupon discount?** The full product subtotal. Tax and shipping are not included in this service.
- **How are discounts rounded?** To the nearest minor currency unit. The discount cannot exceed the subtotal.
- **What does product delete mean?** It retires the product. The product is hidden from the active catalog, but its order history remains.
- **Is payment real?** No. A successful checkout is treated as paid.
- **Can an admin remove a coupon?** An unused coupon can be cancelled. Its record is kept, and a redeemed coupon cannot be cancelled.

## Decision: Use SQLite for local storage

**Context:** The service needs to save data locally and make checkout changes together as one operation. Reviewers also need an easy way to run it.

**Options considered:** Keep data in memory; use SQLite with a third-party native package; use Node's built-in SQLite support; use PostgreSQL.

**Choice:** Use the built-in `node:sqlite` module with a local database file. This requires Node 24.15 or later.

**Why:** SQLite saves data without a separate database server. The built-in module avoids compiling a native package during installation. Node currently labels this SQLite module a release candidate.

**Consequences:** The local database file is created when the service starts and is not committed to Git. The schema and starter products are in the repo. This is convenient for the assignment, but synchronous database calls block Node while they run. For a larger service, use a shared database such as PostgreSQL.

## Decision: Make checkout one database transaction

**Context:** An order, its stock changes, and its coupon use must either all succeed or all fail.

**Options considered:** Change stock before checkout and try to undo it if something fails; reserve stock when items enter carts; use a lock inside the Node process; use a database transaction and database rules.

**Choice:** Checkout runs in one SQLite write transaction. It checks the cart, product status, and stock; saves the order and item details; reduces stock; uses the coupon if supplied; and closes the cart. If any step fails, the transaction rolls back.

**Why:** The database undoes all of the changes together after a failure. SQLite allows only one writer at a time. The transaction starts its write lock before checking stock, and the stock update also refuses to make inventory negative.

**Consequences:** Carts do not hold stock. A customer can add an item and later find that checkout fails because someone else bought the last units. Requests in this Node process cannot interrupt one another during the synchronous database operation. Other processes using the same file wait for SQLite's lock and may fail after the timeout. That timeout error currently becomes a general server error.

## Decision: Make checkout retries safe

**Context:** A customer may retry because the first response timed out, even if checkout actually succeeded.

**Options considered:** Check only whether the cart is already closed; guess whether requests are duplicates based on timing; require a key that identifies the checkout request.

**Choice:** Require an `Idempotency-Key` header. Store it on the order and make it unique. If the same key is sent again for the same cart, return the existing order. If that key is used for another cart, return a conflict. Each cart can also appear on only one order.

**Why:** The key gives retries a clear identity and still works after a service restart. Database uniqueness rules protect against duplicate orders.

**Consequences:** The client must save and reuse the key when retrying. A new key cannot check out a cart that is already closed. Keys do not expire.

## Decision: Generate and redeem coupons safely

**Context:** Coupon generation may be repeated, two checkouts may try the same coupon, and a failed checkout must not use it.

**Options considered:** Generate coupons automatically during checkout; generate them in a background job; let an admin request them; erase cancelled coupons or keep their history.

**Choice:** An admin requests coupon generation. The API checks the order count and existing coupons inside a transaction. It creates one coupon for the latest reached milestone. Checkout marks the coupon as used inside the order transaction. Cancelling an unused coupon moves it to a history table. Redeemed coupons cannot be cancelled.

**Why:** This follows the admin-generation requirement. The transaction prevents two requests from generating the same milestone or redeeming the same coupon. Keeping cancelled coupons prevents a milestone from being issued again.

**Consequences:** No coupon is created until an admin requests one. If the admin waits through several milestones, only the latest one is rewarded. Customers are not notified automatically.

## Decision: Store money as whole minor units

**Context:** Decimal fractions in computer arithmetic can cause small errors in prices and discounts.

**Options considered:** Store money as decimal numbers; store formatted strings; store whole cents or paise as integers.

**Choice:** Store and return money as integer minor units. For example, `1299` means 12.99. Calculate discounts with integer arithmetic, round half up, and cap the discount at the subtotal.

**Why:** Integer amounts avoid floating-point rounding errors and make totals easy to compare.

**Consequences:** The client formats amounts for display. The service supports one currency and does not handle tax, shipping, or amounts larger than JavaScript's safe integer limit.

## Decision: Return useful, consistent errors

**Context:** API clients need to know whether a request was invalid, a resource was missing, or the requested action conflicted with current state.

**Options considered:** Return plain text; use one generic error; return a stable error code and message, with details when useful.

**Choice:** Return errors as `{ "error": { "code", "message", "details"? } }`. Use `400` for invalid input, `404` for missing resources, `409` for state conflicts, and `500` for unexpected errors.

**Why:** Clients can use the code to decide what to do. The message and optional details help people understand the problem.

**Consequences:** Error codes are part of the API and should stay consistent. SQLite lock timeout errors are not yet given a special retryable code; they currently return a general server error.

## Decision: Keep order history when products change

**Context:** Product names, prices, and availability can change after a cart or order exists.

**Options considered:** Keep the cart's original price; prevent changes to products used in carts; permanently delete products; use current prices at checkout and save order details.

**Choice:** Cart views show current prices. Checkout checks current stock and product status, then uses current prices. Each order saves the product name and price used. Product deletion retires it instead of removing the database record.

**Why:** Customers see the current price before checkout, and old orders remain understandable after catalog changes.

**Consequences:** A cart total can change before checkout. A retired product in a cart blocks checkout. The API does not notify customers when prices change.

## Decision: Seed products safely and keep reports read-only

**Context:** Every new local setup needs sample products, but restarts should not create duplicates. Reports must not change service data.

**Options considered:** Commit a filled database file; ask reviewers to add products; seed products with random IDs; seed with fixed IDs and ignore existing rows.

**Choice:** On startup, create the schema and insert five products with fixed IDs. Reports read saved orders, order lines, and coupon records without changing them.

**Why:** A fresh clone can start with sample data, and restarting does not duplicate it. The database file itself stays out of Git.

**Consequences:** Schema setup uses `CREATE TABLE IF NOT EXISTS`; there is no full migration tool yet. The cancellation history table is added automatically when the service starts.

## What is implemented and what is deferred

**Implemented:** Product listing and editing, product retirement, inventory changes, carts, cart stock checks, transactional checkout, checkout retry keys, saved order details, coupons, coupon cancellation, reports, startup seed data, structured API errors,tests and UI

**Deferred:** Login and permissions; real payment, refunds, tax, shipping, and multiple currencies; inventory change audit history; pagination; rate limits; production migrations; better logging and monitoring.

## How this would change for multiple service instances

The current setup uses one local SQLite file. A different file on each service instance would split the stock, orders, and coupons, so that is not safe.

For multiple instances, move to one shared database such as PostgreSQL. Keep the same transaction and uniqueness rules. Lock or conditionally update stock rows, and keep coupon redemption and order creation in the same transaction. Use a connection pool and retry temporary transaction conflicts.

## How AI tools were used

Codex helped with code, documentation and tests. 

## What I would do with two more hours

1. Add more concurrent tests: two admins generating one milestone, many carts competing for a small stock count, and coupon cancellation racing with checkout.
2. Add authentication and authorisation.

