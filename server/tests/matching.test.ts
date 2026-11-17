import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConfigSignature,
  buildIdentityKey,
  compareModels,
  compareVariants,
  matchVariantAgainstProduct,
  toVariantSignature,
} from '../src/intelligence/matching/identity.ts';
import { normalizeSpecs } from '../src/intelligence/normalize/specs.ts';

const baseSpecs = normalizeSpecs({
  RAM: '16GB DDR5',
  'Storage Capacity': '1TB SSD',
  Processor: 'Intel Core Ultra 7 155H',
  'Display Size': '14 inches',
  Colour: 'Titanium Gray',
});

describe('product identity', () => {
  it('builds a stable identity key from brand, model and generation', () => {
    const a = buildIdentityKey('Apple', 'MacBook Pro 14', '2024');
    const b = buildIdentityKey('apple', 'macbook pro 14', '2024');
    assert.equal(a, b);
    assert.notEqual(a, buildIdentityKey('Apple', 'MacBook Air 13', '2024'));
  });

  it('produces identical config signatures for identical configurations', () => {
    const other = normalizeSpecs({
      RAM: '16GB',
      'Storage Capacity': '1TB SSD',
      Processor: 'Intel Core Ultra 7 155H',
      'Display Size': '14"',
      Colour: 'Titanium Gray',
    });
    assert.equal(buildConfigSignature(baseSpecs), buildConfigSignature(other));
  });

  it('produces different config signatures for different RAM or storage', () => {
    const lessRam = normalizeSpecs({
      RAM: '8GB DDR5',
      'Storage Capacity': '1TB SSD',
      Processor: 'Intel Core Ultra 7 155H',
      'Display Size': '14 inches',
      Colour: 'Titanium Gray',
    });
    const lessStorage = normalizeSpecs({
      RAM: '16GB DDR5',
      'Storage Capacity': '512GB SSD',
      Processor: 'Intel Core Ultra 7 155H',
      'Display Size': '14 inches',
      Colour: 'Titanium Gray',
    });

    assert.notEqual(buildConfigSignature(baseSpecs), buildConfigSignature(lessRam));
    assert.notEqual(buildConfigSignature(baseSpecs), buildConfigSignature(lessStorage));
  });
});

describe('variant matching', () => {
  it('treats identical configurations as the same variant', () => {
    const a = toVariantSignature(baseSpecs);
    const b = toVariantSignature(
      normalizeSpecs({
        RAM: '16GB',
        'Storage Capacity': '1TB SSD',
        Processor: 'Intel Core Ultra 7 155H',
        'Display Size': '14"',
        Colour: 'Titanium Grey',
      }),
    );
    const result = compareVariants(a, b);
    assert.equal(result.verdict, 'exact_same_variant');
    assert.ok(result.confidence > 0.8);
  });

  it('separates a distinct marketing colour from a generic one', () => {
    // "Titanium Grey" and "Grey" are different colours on real catalogues.
    // Merging them would be exactly the false-merge the product forbids.
    const titanium = toVariantSignature(
      normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '1TB', Colour: 'Titanium Grey' }),
    );
    const generic = toVariantSignature(
      normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '1TB', Colour: 'Grey' }),
    );
    assert.equal(compareVariants(titanium, generic).verdict, 'same_model_different_variant');
  });

  it('never merges a 16GB/1TB unit with an 8GB/512GB unit', () => {
    const sixteenGb = toVariantSignature(baseSpecs);
    const eightGb = toVariantSignature(
      normalizeSpecs({
        RAM: '8GB DDR5',
        'Storage Capacity': '512GB SSD',
        Processor: 'Intel Core Ultra 7 155H',
        'Display Size': '14 inches',
        Colour: 'Titanium Gray',
      }),
    );

    const result = compareVariants(sixteenGb, eightGb);
    assert.equal(result.verdict, 'same_model_different_variant');
    assert.ok(result.differences.some((d) => d.includes('RAM')));
    assert.ok(result.differences.some((d) => d.includes('storage')));
  });

  it('detects a different storage type as a different variant', () => {
    const ssd = toVariantSignature(normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '1TB SSD' }));
    const hdd = toVariantSignature(normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '1TB HDD' }));
    const result = compareVariants(ssd, hdd);
    assert.equal(result.verdict, 'same_model_different_variant');
  });

  it('treats a shared part number as decisive evidence', () => {
    const a = toVariantSignature(baseSpecs, { partNumber: 'SM-S928B' });
    const b = toVariantSignature(
      normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '512GB SSD' }),
      { partNumber: 'SM-S928B' },
    );
    const result = compareVariants(a, b);
    assert.equal(result.verdict, 'exact_same_variant');
    assert.ok(result.confidence >= 0.95);
  });

  it('reports a conflicting part number as a difference', () => {
    const a = toVariantSignature(baseSpecs, { partNumber: 'SM-S928B' });
    const b = toVariantSignature(baseSpecs, { partNumber: 'SM-S928B1' });
    const result = compareVariants(a, b);
    assert.notEqual(result.verdict, 'exact_same_variant');
    assert.ok(result.differences.some((d) => d.includes('part number')));
  });

  it('downgrades a colour-only difference to a different variant', () => {
    const grey = toVariantSignature(normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '1TB', Colour: 'Grey' }));
    const black = toVariantSignature(normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '1TB', Colour: 'Black' }));
    const result = compareVariants(grey, black);
    assert.equal(result.verdict, 'same_model_different_variant');
    assert.ok(result.differences.some((d) => d.includes('colour')));
  });

  it('matches a candidate against the closest known variant', () => {
    const known = [
      { id: 'v-8-512', signature: toVariantSignature(normalizeSpecs({ RAM: '8GB', 'Storage Capacity': '512GB' })) },
      { id: 'v-16-1tb', signature: toVariantSignature(baseSpecs) },
    ];
    const candidate = toVariantSignature(
      normalizeSpecs({ RAM: '16GB DDR5', 'Storage Capacity': '1TB SSD', Processor: 'Intel Core Ultra 7 155H' }),
    );
    const match = matchVariantAgainstProduct(candidate, known);
    assert.equal(match.variantId, 'v-16-1tb');
    assert.equal(match.result.verdict, 'exact_same_variant');
  });
});

describe('model comparison', () => {
  it('recognises the same model across formatting differences', () => {
    const result = compareModels(
      { brand: 'Samsung', model: 'Galaxy S24 Ultra' },
      { brand: 'samsung', model: 'galaxy s24 ultra' },
    );
    assert.equal(result.verdict, 'same_model');
  });

  it('separates different generations of the same line', () => {
    const result = compareModels(
      { brand: 'Samsung', model: 'Galaxy S24 Ultra', generation: '2024' },
      { brand: 'Samsung', model: 'Galaxy S23 Ultra', generation: '2023' },
    );
    assert.notEqual(result.verdict, 'same_model');
  });

  it('separates different brands entirely', () => {
    const result = compareModels(
      { brand: 'Samsung', model: 'Galaxy S24 Ultra' },
      { brand: 'Xiaomi', model: '14 Ultra' },
    );
    assert.equal(result.verdict, 'different_product');
  });
});
