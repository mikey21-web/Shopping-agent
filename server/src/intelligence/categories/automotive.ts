/**
 * Automotive parts category profile.
 *
 * Automotive is a safety-critical category with a hard compatibility
 * requirement: a part that fits the wrong vehicle is worse than no part at
 * all. The profile therefore treats fitment and certification as
 * variant-defining and required-for-match, and the ownership model accounts
 * for the fact that a wrong part can damage a vehicle.
 */

import type { CategoryProfile } from './types.ts';

export const automotiveProfile: CategoryProfile = {
  id: 'automotive',
  label: 'Automotive parts',
  aliases: [
    'car parts',
    'auto parts',
    'automobile parts',
    'spare parts',
    'car accessories',
    'brake pad',
    'brake pads',
    'oil filter',
    'air filter',
    'wiper blades',
    'car battery',
    'battery for car',
    'engine oil',
    'car filter',
    'headlight bulb',
    'wiper',
    'tyre',
    'wheel',
  ],
  requestTerms: ['कार पार्ट्स', 'ऑटो पार्ट्स', 'स्पेयर पार्ट'],
  specialised: false,
  /**
   * A wrong part can damage a vehicle or, in the case of brakes and tyres,
   * endanger a person. Evidence handling here is strict.
   */
  safetyCritical: true,
  requiresCertification: true,

  specFields: [
    {
      key: 'partNumber',
      label: 'Part number',
      type: 'string',
      aliases: ['part number', 'part no', 'oem part number', 'model number', 'partnumber'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'vehicleFitment',
      label: 'Vehicle fitment',
      type: 'string',
      aliases: ['fits', 'compatible with', 'fitment', 'vehicle', 'applicable for', 'makes'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'certification',
      label: 'Certification',
      type: 'string',
      aliases: ['certification', 'standard', 'isi', 'bis', 'ece', 'dot', 'approved'],
      variantDefining: false,
      requiredForMatch: false,
    },
    {
      key: 'material',
      label: 'Material',
      type: 'string',
      aliases: ['material', 'construction', 'compound'],
      variantDefining: false,
      requiredForMatch: false,
    },
    {
      key: 'warrantyMonths',
      label: 'Warranty',
      type: 'number',
      unit: 'months',
      aliases: ['warranty', 'warranty period'],
      variantDefining: false,
      requiredForMatch: false,
    },
  ],
  variantFields: ['partNumber', 'vehicleFitment', 'material'],
  requiredMatchFields: ['partNumber', 'vehicleFitment'],

  decisionDimensions: [
    {
      key: 'compatibility',
      label: 'Fitment',
      keywords: ['fit', 'fits', 'compatible', 'model', 'year', 'स-compatible'],
      description: 'Whether the part actually fits the exact vehicle, year and variant.',
    },
    {
      key: 'safety',
      label: 'Safety & certification',
      keywords: ['safety', 'certified', 'isi', 'bis', 'ece', 'original'],
      description: 'Whether the part meets the applicable safety standard.',
    },
    {
      key: 'durability',
      label: 'Durability',
      keywords: ['durability', 'lasting', 'wear', 'life', 'टिकाऊ'],
      description: 'Expected life before the part needs replacing again.',
    },
    {
      key: 'value',
      label: 'Value for money',
      keywords: ['value', 'worth', 'price', 'cheap', 'affordable'],
      description: 'Price against the life of the part and the cost of the alternative.',
    },
    {
      key: 'service',
      label: 'Fitment & installation',
      keywords: ['installation', 'fitment', 'labour', 'garage', 'professional'],
      description: 'Whether it can be fitted at home or needs a workshop.',
    },
  ],

  reviewAspects: ['compatibility', 'durability', 'build_quality', 'value', 'service', 'performance'],

  risks: [
    {
      key: 'no_fitment_list',
      label: 'Vehicle fitment is not stated',
      severity: 'critical',
      evaluate: ({ specs }) =>
        !specs.vehicleFitment
          ? 'The page does not list which vehicles this part fits. A part that does not fit is unsafe and can damage the vehicle — confirm the fitment before buying.'
          : null,
    },
    {
      key: 'no_certification',
      label: 'No safety certification is stated',
      severity: 'warning',
      evaluate: ({ specs }) =>
        !specs.certification
          ? 'No BIS/ISI, ECE or equivalent certification is stated. For brakes, tyres and steering parts this is a reason not to buy.'
          : null,
    },
    {
      key: 'aftermarket_ambiguity',
      label: 'Aftermarket part presented as original',
      severity: 'warning',
      evaluate: ({ specs }) =>
        typeof specs.material === 'string' && /aftermarket|replacement|compatible/i.test(specs.material)
          ? 'This appears to be an aftermarket part rather than the OEM item. It may fit, but the materials and tolerances differ from the original.'
          : null,
    },
    {
      key: 'no_warranty',
      label: 'No warranty is stated',
      severity: 'info',
      evaluate: ({ warrantyMonths }) =>
        warrantyMonths === undefined
          ? 'No warranty period is published for this part.'
          : null,
    },
  ],

  ownership: {
    label: 'Part ownership',
    horizonYears: 3,
    /**
     * Consumable parts have a short life and are replaced on a service
     * schedule. The "running cost" is really the cost per service interval.
     */
    annualRunningCostPaise(specs) {
      const price = Number(specs.pricePaise ?? 0);
      if (!Number.isFinite(price) || price <= 0) return null;
      // Most wear parts are replaced every two to three years.
      return Math.round(price / 3);
    },
    note:
      'Wear parts are replaced on a service schedule rather than consumed continuously. The figure shown is the amortised cost per year over a three-year life.',
  },

  components: [],
};
