// Represent an expected API failure with its HTTP status and client-facing details.
class ApiError extends Error {
  // Save the API response fields alongside the normal JavaScript error message.
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Stop the current operation by throwing a structured API error.
const fail = (status, code, message, details) => { throw new ApiError(status, code, message, details); };

module.exports = { ApiError, fail };
