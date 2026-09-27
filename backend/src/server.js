// Load local environment settings before importing modules that read them.
require('dotenv').config();
const app = require('./app');
const port = Number(process.env.PORT || 3000);

// Start accepting API requests on the configured port.
app.listen(port, "0.0.0.0", () =>  console.log(`Checkout and rewards API listening on http://localhost:${port}`));
