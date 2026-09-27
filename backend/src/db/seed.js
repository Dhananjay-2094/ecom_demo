// Stable product IDs keep startup seeding repeatable across restarts.
const products = [
  ['10000000-0000-4000-8000-000000000001', 'Everyday Mug', 1299, 100],
  ['10000000-0000-4000-8000-000000000002', 'Canvas Tote', 1899, 45],
  ['10000000-0000-4000-8000-000000000003', 'Desk Notebook', 799, 80],
  ['10000000-0000-4000-8000-000000000004', 'Insulated Bottle', 2499, 3],
  ['10000000-0000-4000-8000-000000000005', 'Wireless Desk Lamp', 4999, 12]
];

// Insert the starter catalog once; existing IDs are left unchanged.
module.exports = function seed(db) {
  // Prepare one reusable insert statement for each seeded product.
  const insert = db.prepare(`INSERT OR IGNORE INTO products (id, name, unit_price_minor, inventory)
    VALUES (?, ?, ?, ?)`);
  // Add all seed products together so partial seeding cannot be left behind.
  const seedProducts = db.transaction(() => {
    // Insert each product using its stable ID and configured starting stock.
    for (const product of products) insert.run(...product);
  });
  // Apply the seed transaction during database startup.
  seedProducts();
};
