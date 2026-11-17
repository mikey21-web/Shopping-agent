/**
 * The footwear category profile.
 *
 * Shoes are not electronics with a different name. A shoe decision turns
 * on fit, cushioning, grip and how the sole wears — and the two things
 * that ruin a shoe purchase most often (wrong size, a sole that separates)
 * are both invisible in a specification table and loud in owner reports.
 *
 * This profile therefore does three things a generic fashion profile
 * cannot:
 *
 *  1. **Models size properly.** A shoe size is only meaningful together
 *     with its standard and the fit, because "UK 8" from one maker is not
 *     "UK 8" from another. Size is variant-defining and required for a
 *     match.
 *  2. **Splits the shoe by intended use.** Running, walking, gym, casual,
 *     formal, sports-specific and hiking shoes are bought for different
 *     reasons and fail in different ways. The intended use is a decision
 *     dimension, not a tag.
 *  3. **Treats owner complaints as first-class evidence.** Fit running
 *     small, sole separation and stitching failure are the recurring
 *     complaints in this category, and the review aspects are declared so
 *     the ownership analysis looks for exactly those.
 */

import type { CategoryId } from '../../domain/types.ts';
import type { CategoryProfile } from './types.ts';
import { SHOE_COMPONENTS } from './shoes-components.ts';
import { SHOE_TYPES, detectShoeType, type ShoeType } from './shoe-types.ts';

/* ------------------------------------------------------------------ */
/* The profile                                                          */
/* ------------------------------------------------------------------ */

export const shoesProfile: CategoryProfile = {
  id: 'shoes' as CategoryId,
  label: 'Footwear',
  aliases: [
    'shoes',
    'footwear',
    'sneakers',
    'running shoes',
    'walking shoes',
    'gym shoes',
    'formal shoes',
    'hiking shoes',
    'trainers',
    'loafers',
    'sandals',
    'flip flops',
    'sports shoes',
    'boots',
  ],
  requestTerms: [
    'buy shoes',
    'buy sneakers',
    'buy footwear',
    'footwear purchase',
    'new shoes',
    'running shoes for jogging',
  ],

  specFields: [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      aliases: ['size', 'shoe size', 'uk size', 'us size', 'eu size', 'india size', 'uk'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'sizeStandard',
      label: 'Size Standard',
      type: 'string',
      aliases: ['size standard', 'size chart', 'measurement'],
      values: ['UK', 'US', 'EU', 'India', 'UK/US'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'width',
      label: 'Width',
      type: 'string',
      aliases: ['width', 'shoe width'],
      values: ['Narrow', 'Standard', 'Wide', 'Extra Wide'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'upperMaterial',
      label: 'Upper Material',
      type: 'string',
      aliases: ['upper material', 'material', 'outer material'],
      variantDefining: true,
      requiredForMatch: false,
    },
    {
      key: 'midsoleMaterial',
      label: 'Midsole Material',
      type: 'string',
      aliases: ['midsole', 'midsole material', 'cushioning material'],
      variantDefining: false,
      requiredForMatch: false,
    },
    {
      key: 'outsoleMaterial',
      label: 'Outsole Material',
      type: 'string',
      aliases: ['outsole', 'outsole material', 'sole material', 'rubber'],
      variantDefining: false,
      requiredForMatch: false,
    },
    {
      key: 'soleThicknessMm',
      label: 'Sole Thickness',
      type: 'number',
      unit: 'mm',
      aliases: ['sole thickness', 'stack height', 'drop', 'heel-to-toe drop'],
      variantDefining: false,
      requiredForMatch: false,
    },
    {
      key: 'closureType',
      label: 'Closure',
      type: 'string',
      aliases: ['closure', 'closure type', 'fastening'],
      values: ['Laces', 'Velcro', 'Slip-on', 'Buckles', 'Zippers'],
      variantDefining: true,
      requiredForMatch: false,
    },
    {
      key: 'weightGrams',
      label: 'Weight',
      type: 'number',
      unit: 'g',
      aliases: ['weight', 'weight per shoe', 'net weight'],
      variantDefining: false,
      requiredForMatch: false,
    },
    {
      key: 'gender',
      label: 'Gender',
      type: 'string',
      aliases: ['gender', 'department', 'men/women'],
      values: ['Men', 'Women', 'Unisex', 'Kids'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'colour',
      label: 'Colour',
      type: 'string',
      aliases: ['colour', 'color'],
      variantDefining: true,
      requiredForMatch: false,
    },
    {
      key: 'waterResistant',
      label: 'Water Resistant',
      type: 'boolean',
      aliases: ['water resistant', 'waterproof', 'water proof'],
      variantDefining: true,
      requiredForMatch: false,
    },
    {
      key: 'surface',
      label: 'Surface',
      type: 'string',
      aliases: ['surface', 'terrain', 'tread pattern'],
      values: ['Road', 'Trail', 'Indoor', 'Court', 'All-weather', 'Mixed'],
      variantDefining: true,
      requiredForMatch: false,
    },
  ],

  variantFields: [
    'size',
    'sizeStandard',
    'width',
    'gender',
    'colour',
    'upperMaterial',
    'closureType',
    'waterResistant',
    'surface',
  ],

  // A shoe at the wrong size is not the same shoe. Size, standard and
  // gender must be known on both sides before two listings can be
  // declared the same item.
  requiredMatchFields: ['size', 'sizeStandard', 'gender'],

  decisionDimensions: [
    {
      key: 'fit',
      label: 'Fit & Sizing',
      keywords: ['fit', 'size', 'sizing', 'runs small', 'runs large', 'tight', 'roomy', 'narrow'],
      description: 'Whether the size runs true and suits the shopper\'s foot.',
    },
    {
      key: 'comfort',
      label: 'Comfort',
      keywords: ['comfortable', 'comfort', 'cushioning', 'all-day', 'padding', 'break-in'],
      description: 'How the shoe feels over hours of wear.',
    },
    {
      key: 'cushioning',
      label: 'Cushioning & Support',
      keywords: ['cushioning', 'support', 'arch', 'heel strike', 'impact', 'foam', 'plush'],
      description: 'How much the midsole absorbs and how well the shoe supports the foot.',
    },
    {
      key: 'grip',
      label: 'Grip & Traction',
      keywords: ['grip', 'traction', 'slip-resistant', 'outsole', 'tread', 'wet', 'ice'],
      description: 'How the outsole holds on the ground the buyer will use it on.',
    },
    {
      key: 'breathability',
      label: 'Material & Breathability',
      keywords: ['breathable', 'mesh', 'ventilation', 'airflow', 'material', 'knit'],
      description: 'How well the upper moves heat and moisture away from the foot.',
    },
    {
      key: 'durability',
      label: 'Durability & Sole Wear',
      keywords: ['durable', 'sole wear', 'longevity', 'lasting', 'separation', 'stitching', 'falls apart'],
      description: 'How the shoe holds up, especially at the sole and the seams.',
    },
    {
      key: 'weight',
      label: 'Weight',
      keywords: ['lightweight', 'heavy', 'weight'],
      description: 'How much the shoe weighs, which matters for pace and for long days on foot.',
    },
    {
      key: 'style',
      label: 'Style',
      keywords: ['style', 'look', 'appearance', 'design', 'formal'],
      description: 'How the shoe looks, which matters when it is worn for its appearance.',
    },
  ],

  // The aspects mined from owner reviews. These are the ones that decide
  // a shoe purchase.
  reviewAspects: [
    'fit',
    'comfort',
    'durability',
    'build_quality',
    'design',
    'value',
    'performance',
    'service',
  ],

  risks: [
    {
      key: 'size_runs_small',
      label: 'Size May Run Small',
      severity: 'warning',
      evaluate: ({ reviewComplaints }) =>
        reviewComplaints.some((complaint) =>
          /runs? small|sizing (?:is )?(?:small|tight)|too small|size chart (?:is )?wrong/i.test(complaint),
        )
          ? 'Owners report this size runs small. Consider ordering half a size up, and check the return window before you commit.'
          : null,
    },
    {
      key: 'sole_separation',
      label: 'Sole Separation',
      severity: 'critical',
      evaluate: ({ reviewComplaints }) =>
        reviewComplaints.some((complaint) =>
          /sole (?:separat|come|came|peel)|falls? apart|glued|outsole (?:came|separat)/i.test(complaint),
        )
          ? 'Owners report the sole separating from the upper. This is a construction failure and is not something the shopper can work around.'
          : null,
    },
    {
      key: 'stitching_failure',
      label: 'Stitching Failure',
      severity: 'warning',
      evaluate: ({ reviewComplaints }) =>
        reviewComplaints.some((complaint) =>
          /stitch|thread came|seam|poor stitching/i.test(complaint),
        )
          ? 'Owners report the stitching giving way. Check whether the warranty covers it.'
          : null,
    },
    {
      key: 'no_return_policy',
      label: 'Return Policy Unclear',
      severity: 'info',
      evaluate: ({ extra }) =>
        extra.returnPolicyKnown === false
          ? 'The return policy for this listing was not published. Confirm the return window before ordering, because a shoe that fits badly is only useful if it can be returned.'
          : null,
    },
  ],

  ownership: {
    label: 'Footwear ownership',
    horizonYears: 2,
    note: 'Athletic shoes typically last 300-500 miles of running before the midsole loses its response. Casual leather shoes last much longer. Cost per wear is the honest measure.',
  },

  components: SHOE_COMPONENTS,
  safetyCritical: false,
  requiresCertification: false,
  specialised: true,

  // Footwear is bought on fit and comfort, so those weigh more than the
  // market dimension, which matters for electronics but not much here.
  decisionWeights: {
    requirement: 0.25,
    product: 0.25,
    ownership: 0.2,
    financial: 0.15,
    compatibility: 0.1,
    market: 0.05,
    risk: 0.05,
    decision: 0.05,
  },
};

export { SHOE_TYPES, SHOE_TYPE_KEYS, detectShoeType } from './shoe-types.ts';
export type { ShoeType } from './shoe-types.ts';
