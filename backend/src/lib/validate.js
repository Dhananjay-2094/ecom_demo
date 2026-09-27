const { fail } = require('./errors');

// Require a positive whole number for quantities.
function positiveInteger(value, field = 'quantity') {
  // Reject decimals, unsafe integers, zero, and negative quantities.
  if (!Number.isSafeInteger(value) || value <= 0) fail(400, 'INVALID_QUANTITY', `${field} must be a positive integer`);
  // Return the validated number for the caller to use.
  return value;
}

// Require a non-empty string and remove surrounding whitespace.
function requiredString(value, field) {
  // Reject absent, non-string, and whitespace-only values.
  if (typeof value !== 'string' || value.trim().length === 0) fail(400, 'INVALID_INPUT', `${field} is required`);
  // Return the cleaned value.
  return value.trim();
}

module.exports = { positiveInteger, requiredString };
