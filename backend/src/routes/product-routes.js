const express = require('express');
const admin = require('../services/admin-service');
const router = express.Router();

// List only active products for the customer storefront.
router.get('/', (_req, res) => res.json({ products: admin.listProducts() }));
// Look up one product by ID, including a retired product.
router.get('/:productId', (req, res) => res.json(admin.getProduct(req.params.productId)));
module.exports = router;
