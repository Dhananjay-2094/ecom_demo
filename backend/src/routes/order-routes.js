const express = require('express');
const { getOrder } = require('../services/checkout-service');
const router = express.Router();

// Return the saved order and its item/price snapshots.
router.get('/:orderId', (req, res) => res.json(getOrder(req.params.orderId)));

module.exports = router;
