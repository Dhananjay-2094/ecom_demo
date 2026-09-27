const express = require('express');
const { ApiError } = require('./lib/errors');
const app = express();
const cors = require('cors');

app.use(cors({
  origin: [
    'http://localhost:4200',
    'https://ecom-demo-blush-six.vercel.app',
    'https://ecom-demo-6ory.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Hide Express's version header from API responses.
app.disable('x-powered-by');
// Parse JSON request bodies and reject payloads larger than 32 KB.
app.use(express.json({ limit: '32kb' }));
// Provide a small endpoint for checking whether the API is running.
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
// Route product requests to product handlers.
app.use('/api/products', require('./routes/product-routes'));
// Route cart changes and checkout requests to cart handlers.
app.use('/api/carts', require('./routes/cart-routes'));
// Route order lookups to order handlers.
app.use('/api/orders', require('./routes/order-routes'));
// Route catalog administration, coupon, and reporting requests to admin handlers.
app.use('/api/admin', require('./routes/admin-routes'));

// Convert any unmatched URL into a consistent API 404 response.
app.use((req, _res, next) => next(new ApiError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`)));
// Convert known API errors and unexpected errors into JSON responses.
app.use((err, _req, res, _next) => {
  // Preserve the status, code, message, and safe details for expected errors.
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  // Report malformed JSON as a client error instead of an internal error.
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
  // Log unexpected failures on the server without exposing internals to clients.
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

module.exports = app;
