const express = require('express');
const admin = require('../services/admin-service');
const router = express.Router();

// List active and retired products for the admin catalog.
router.get('/products', (_req, res) => res.json({ products: admin.listProducts(true) }));
// Create a product and return its generated ID.
router.post('/products', (req, res) => res.status(201).json(admin.createProduct(req.body || {})));
// Update a product's name or price.
router.patch('/products/:productId', (req, res) => res.json(admin.updateProduct(req.params.productId, req.body || {})));
// Retire a product without deleting its order history.
router.delete('/products/:productId', (req, res) => res.json(admin.retireProduct(req.params.productId)));
// Apply a signed inventory adjustment to one product.
router.post('/products/:productId/inventory-adjustments', (req, res) => res.json(admin.adjustInventory(req.params.productId, req.body?.change, req.body?.reason)));
// Generate one coupon for the latest eligible reward milestone.
router.post('/coupons/generate', (_req, res) => res.status(201).json(admin.generateCoupon()));
// List active, redeemed, and cancelled coupons.
router.get('/coupons', (_req, res) => res.json({ coupons: admin.listCoupons() }));
// Cancel an unused coupon while retaining its milestone history.
router.delete('/coupons/:code', (req, res) => res.json(admin.cancelCoupon(req.params.code)));
// Return the current read-only sales and coupon summary.
router.get('/report', (_req, res) => res.json(admin.report()));

module.exports = router;
