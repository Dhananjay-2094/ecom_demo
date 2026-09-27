const express = require('express');
const cart = require('../services/cart-service');
const checkout = require('../services/checkout-service');
const router = express.Router();

// Create a new empty cart.
router.post('/', (_req, res) => res.status(201).json(cart.createCart()));
// Return the cart with current product prices and totals.
router.get('/:cartId', (req, res) => res.json(cart.getCart(req.params.cartId)));
// Add a quantity of a product to an open cart.
router.post('/:cartId/items', (req, res) => res.status(201).json(cart.addItem(req.params.cartId, req.body.productId, req.body.quantity)));
// Set a cart item's quantity to the requested amount.
router.patch('/:cartId/items/:productId', (req, res) => res.json(cart.updateItem(req.params.cartId, req.params.productId, req.body.quantity)));
// Remove one product from an open cart.
router.delete('/:cartId/items/:productId', (req, res) => res.json(cart.removeItem(req.params.cartId, req.params.productId)));
// Place the order, using the key to make client retries safe.
router.post('/:cartId/checkout', (req, res) => res.status(201).json(checkout.checkout(req.params.cartId, req.get('Idempotency-Key'), req.body.couponCode)));

module.exports = router;
