# Storefront and admin UI

A small Angular storefront for the checkout and rewards API. It includes product browsing, cart editing, coupon checkout, and an admin dashboard for product/stock changes, coupons, and reporting. Admin routes are not authenticated in this demo, matching the backend scope.

## Run locally

Start the backend first in another terminal:

```powershell
cd ecom__backend
npm install
npm run dev
```

Then start the frontend:

```powershell
cd ecom__frontend
npm install
npm start
```

Open `http://localhost:4200`. The Angular development server proxies `/api` requests to `http://localhost:3000` using `proxy.conf.json`.

The UI displays money as plain two-decimal amounts because the backend currently does not set a currency. Admin product price fields use integer minor units (1299 = 12.99). Inventory adjustment accepts signed amounts; enter a negative number to remove stock.
