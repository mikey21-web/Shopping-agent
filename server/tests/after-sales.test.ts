import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';

import { applySchema, closeDb, getDb, run } from '../src/db/index.ts';
import { listPurchasesByShopper, nextPurchaseId, recordPurchase, scoreProductAfterSales } from '../src/services/after-sales.ts';

const productId = 'p-after-sales-test';
const shopperId = `u-${process.pid}-${Date.now()}`;

before(() => {
  applySchema();
  run('DELETE FROM products WHERE id = ?', productId);
  run(
    `INSERT INTO products (
      id, brand, model, display_name, category, identity_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    productId,
    'TestBrand',
    'Test Model',
    'After Sales Test Laptop',
    'laptop',
    `identity-${productId}`,
    new Date().toISOString(),
    new Date().toISOString(),
  );
});

after(() => {
  run('DELETE FROM purchases WHERE shopper_id = ?', shopperId);
  run('DELETE FROM products WHERE id = ?', productId);
  closeDb();
});

test('after-sales scores an unknown product with the generic baseline', () => {
  const score = scoreProductAfterSales(productId);
  assert.equal(score.productId, productId);
  assert.ok(score.score >= 0);
  assert.ok(score.score <= 100);
});

test('recordPurchase persists ownership and listPurchasesByShopper reads it back', () => {
  recordPurchase({
    id: nextPurchaseId('purchase'),
    shopperId,
    productId,
    variantId: null,
    category: 'laptop',
    purchasedAt: new Date().toISOString(),
    sourceUrl: 'https://example.com/product',
    pricePaise: 10_000_00,
    source: 'web',
    notes: 'Tested purchase memory.',
  });
  const purchases = listPurchasesByShopper(shopperId).filter((purchase) => purchase.productId === productId);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0]?.pricePaise, 10_000_00);
});
