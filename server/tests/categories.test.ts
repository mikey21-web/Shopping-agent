import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  componentsForCategory,
  detectCategoryFromText,
  getCategory,
  listCategories,
  variantFieldsForCategory,
} from '../src/intelligence/categories/index.ts';
import {
  connectorFamily,
  normaliseCondition,
  compareVariants,
  toVariantSignature,
} from '../src/intelligence/matching/identity.ts';
import { normalizeSpecs } from '../src/intelligence/normalize/specs.ts';

describe('category registry', () => {
  it('registers the categories SahiPick supports', () => {
    const ids = listCategories().map((profile) => profile.id);
    for (const expected of [
      'smartphone',
      'laptop',
      'tv',
      'audio',
      'smartwatch',
      'camera',
      'appliance',
      'furniture',
      'fashion',
      'beauty',
      'grocery',
    ]) {
      assert.ok(ids.includes(expected as never), `missing category ${expected}`);
    }
  });

  it('detects a category from a natural request', () => {
    assert.equal(detectCategoryFromText('I need a washing machine under 30000'), 'appliance');
    assert.equal(detectCategoryFromText('best laptop for coding'), 'laptop');
    // Footwear has its own profile, so a shoe request resolves to it
    // rather than to the broader fashion category.
    assert.equal(detectCategoryFromText('running shoes for jogging'), 'shoes');
    assert.equal(detectCategoryFromText('a pair of formal shoes for a wedding'), 'shoes');
    assert.equal(detectCategoryFromText('a plain cotton tshirt'), 'fashion');
    assert.equal(detectCategoryFromText('a perfume for my wife'), 'beauty');
    assert.equal(detectCategoryFromText('5kg rice'), 'grocery');
  });

  it('gives each category its own variant-defining fields', () => {
    // A washing machine is separated by capacity, not by RAM.
    assert.ok(variantFieldsForCategory('appliance').includes('capacityKg'));
    // A phone is separated by RAM and storage.
    assert.ok(variantFieldsForCategory('smartphone').includes('ramGb'));
    // A shoe is separated by size.
    assert.ok(variantFieldsForCategory('fashion').includes('size'));
  });

  it('marks only some categories as having a bespoke scoring model', () => {
    assert.equal(componentsForCategory('smartphone').specialised, true);
    assert.equal(componentsForCategory('laptop').specialised, true);
    assert.equal(componentsForCategory('appliance').specialised, false);
    // A non-specialised category still gets components — the generic set.
    assert.ok(componentsForCategory('appliance').components.length > 0);
  });

  it('declares an ownership cost model for every category', () => {
    for (const profile of listCategories()) {
      assert.ok(profile.ownership, `${profile.id} has no ownership model`);
      assert.ok(profile.ownership.note.length > 0, `${profile.id} has no ownership note`);
    }
  });

  it('models running cost only for categories that have one', () => {
    const appliance = getCategory('appliance');
    assert.equal(typeof appliance?.ownership.annualRunningCostPaise, 'function');
    const cost = appliance?.ownership.annualRunningCostPaise?.({ powerWatts: 500 });
    // 500W x 3h x 365d = 547.5 kWh x Rs 7.5 = Rs 4106 = 410625 paise.
    assert.equal(cost, 410625);

    const smartphone = getCategory('smartphone');
    assert.equal(smartphone?.ownership.annualRunningCostPaise, undefined);
  });

  it('marks consumable and safety-sensitive categories', () => {
    // Food and cosmetics can genuinely harm the buyer — allergies, spoiled
    // goods, counterfeits, skin reactions — so they carry the stricter
    // evidence handling.
    assert.equal(getCategory('grocery')?.safetyCritical, true);
    assert.equal(getCategory('beauty')?.safetyCritical, true);

    // Safety-sensitive is not the same as certification-required. A missing
    // licence number on a retailer listing is a gap to report for food and
    // cosmetics, not a reason to refuse the recommendation.
    assert.equal(getCategory('grocery')?.requiresCertification, false);
    assert.equal(getCategory('beauty')?.requiresCertification, false);

    // A brake pad without a certification is a different matter entirely.
    assert.equal(getCategory('automotive')?.safetyCritical, true);
    assert.equal(getCategory('automotive')?.requiresCertification, true);

    assert.equal(getCategory('laptop')?.safetyCritical, false);
  });
});

describe('variant identity rules (adapted from ValuSee, MIT)', () => {
  it('normalises conditions into comparable buckets', () => {
    assert.equal(normaliseCondition('Brand New'), 'new');
    assert.equal(normaliseCondition('refurbished'), 'refurbished');
    assert.equal(normaliseCondition('Open Box'), 'open_box');
    assert.equal(normaliseCondition('Used'), 'used');
  });

  it('detects connector families', () => {
    assert.equal(connectorFamily('USB-C'), 'usb-c');
    assert.equal(connectorFamily('Lightning connector'), 'lightning');
    assert.equal(connectorFamily('3.5mm jack'), 'legacy');
  });

  it('never merges a new item with a refurbished one', () => {
    const newSpec = toVariantSignature(normalizeSpecs({ RAM: '16GB' }), { partNumber: 'X1' });
    const refurbished = toVariantSignature(normalizeSpecs({ RAM: '16GB' }), { partNumber: 'X1' });
    refurbished.condition = 'refurbished';

    const result = compareVariants(newSpec, refurbished);
    assert.equal(result.verdict, 'same_model_different_variant');
    assert.ok(result.differences.some((d) => d.includes('condition')));
  });

  it('never merges a USB-C variant with a Lightning variant', () => {
    const usbC = toVariantSignature(normalizeSpecs({ RAM: '16GB' }), { partNumber: 'X1' });
    const lightning = toVariantSignature(normalizeSpecs({ RAM: '16GB' }), { partNumber: 'X1' });
    usbC.interface = 'usb-c';
    lightning.interface = 'lightning';

    const result = compareVariants(usbC, lightning);
    assert.equal(result.verdict, 'same_model_different_variant');
    assert.ok(result.differences.some((d) => d.includes('interface')));
  });

  it('treats missing data as unproven rather than as agreement', () => {
    // Storage is unknown on the right-hand side, so the match is weaker and
    // the explanation says so.
    const complete = toVariantSignature(normalizeSpecs({ RAM: '16GB', 'Storage Capacity': '1TB SSD' }));
    const partial = toVariantSignature(normalizeSpecs({ RAM: '16GB' }));

    const result = compareVariants(complete, partial);
    assert.equal(result.verdict, 'exact_same_variant');
    assert.ok(result.confidence < 0.96);
    assert.match(result.explanation, /missing data/i);
  });
});
