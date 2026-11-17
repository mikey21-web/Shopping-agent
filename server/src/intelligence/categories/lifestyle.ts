/**
 * Lifestyle category profiles.
 * Covers appliances, furniture, fashion, beauty and grocery.
 */

import type { CategoryId } from '../../domain/types.ts';
import type { CategoryProfile } from './types.ts';

/* ------------------------------------------------------------------ */
/* Appliance                                                           */
/* ------------------------------------------------------------------ */

export const applianceProfile: CategoryProfile = {
  id: 'appliance' as CategoryId,
  label: 'Appliance',
  aliases: [
    'appliance',
    'home appliance',
    'kitchen appliance',
    'washing machine',
    'refrigerator',
    'fridge',
    'microwave',
    'air conditioner',
    'ac',
    'dishwasher',
    'mixer grinder',
    'water purifier',
    'vacuum cleaner',
  ],
  requestTerms: [
    'buy appliance',
    'home appliance',
    'kitchen appliance',
    'buy washing machine',
    'buy refrigerator',
    'buy fridge',
  ],

  specFields: [
    {
      key: 'capacityKg',
      label: 'Capacity',
      type: 'number',
      unit: 'kg',
      aliases: ['capacity', 'capacity kg', 'wash capacity'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'energyRating',
      label: 'Energy Rating',
      type: 'string',
      aliases: ['energy rating', 'star rating', 'bep'],
      values: ['A+++', 'A++', 'A+', 'B', 'C'],
      variantDefining: true,
      requiredForMatch: false,
    },
    {
      key: 'inverter',
      label: 'Inverter Technology',
      type: 'boolean',
      aliases: ['inverter', 'inverter technology', 'dc inverter'],
      variantDefining: true,
      requiredForMatch: false,
    },
    {
      key: 'powerWatts',
      label: 'Rated Power',
      type: 'number',
      unit: 'W',
      aliases: ['power', 'power consumption', 'rated power'],
      variantDefining: false,
      requiredForMatch: false,
    },
    {
      key: 'colour',
      label: 'Colour',
      type: 'string',
      aliases: ['colour', 'color'],
      variantDefining: true,
      requiredForMatch: false,
    },
  ],
  variantFields: ['capacityKg', 'energyRating', 'inverter', 'colour'],
  requiredMatchFields: ['capacityKg'],

  decisionDimensions: [
    {
      key: 'performance',
      label: 'Performance',
      keywords: ['performance', 'power', 'speed', 'wash quality'],
      description: 'How well the appliance does the job it was bought for.',
    },
    {
      key: 'durability',
      label: 'Durability',
      keywords: ['durable', 'long-lasting', 'reliability', 'lasts'],
      description: 'How it holds up over years of regular use.',
    },
    {
      key: 'energyEfficiency',
      label: 'Energy Efficiency',
      keywords: ['energy saving', 'low power', 'inverter', 'electricity bill'],
      description: 'The running cost over the appliance\'s life.',
    },
    {
      key: 'value',
      label: 'Value for Money',
      keywords: ['value', 'worth', 'price'],
      description: 'What the shopper gets relative to what they pay.',
    },
  ],

  reviewAspects: ['performance', 'durability', 'running_cost', 'noise', 'value', 'service'],

  risks: [
    {
      key: 'malfunction',
      label: 'Risk of Malfunction',
      severity: 'critical',
      evaluate: () => 'Always check for certified products and warranty',
    },
  ],

  ownership: {
    label: 'Appliance ownership',
    horizonYears: 7,
    /**
     * Annual electricity cost, computed from the rated power draw.
     *
     * Assumption: 3 hours of use per day at the rated wattage, at the
     * Indian residential tariff of Rs 7.5 per kWh. The assumption is
     * stated here rather than hidden so the shopper can judge it.
     */
    annualRunningCostPaise: (specs) => {
      const watts = typeof specs.powerWatts === 'number' ? specs.powerWatts : null;
      if (watts === null || watts <= 0) return null;
      const hoursPerDay = 3;
      const kwhPerYear = (watts * hoursPerDay * 365) / 1000;
      const paisePerKwh = 750; // Rs 7.50
      return Math.round(kwhPerYear * paisePerKwh);
    },
    note: 'Lifespan varies by type: refrigerators 10-15 years, washing machines 10-15 years, microwaves 6-10 years.',
  },

  components: [],
  safetyCritical: false,
  requiresCertification: false,
  specialised: false,
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

/* ------------------------------------------------------------------ */
/* Furniture                                                           */
/* ------------------------------------------------------------------ */

export const furnitureProfile: CategoryProfile = {
  id: 'furniture' as CategoryId,
  label: 'Furniture',
  aliases: ['furniture', 'home furniture', 'living room furniture', 'sofa', 'bed', 'table', 'chair'],
  requestTerms: ['buy furniture', 'home furniture', 'living room furniture'],

  specFields: [
    {
      key: 'material',
      label: 'Material',
      type: 'string',
      aliases: ['wood type', 'upholstery material', 'material', 'primary material'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'dimensions',
      label: 'Dimensions',
      type: 'string',
      aliases: ['dimensions', 'size', 'length', 'width', 'height'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'colour',
      label: 'Colour',
      type: 'string',
      aliases: ['colour', 'color', 'finish'],
      variantDefining: true,
      requiredForMatch: false,
    },
    {
      key: 'loadCapacityKg',
      label: 'Load Capacity',
      type: 'number',
      unit: 'kg',
      aliases: ['load capacity', 'max load', 'weight capacity'],
      variantDefining: false,
      requiredForMatch: false,
    },
  ],
  variantFields: ['material', 'dimensions', 'colour'],
  requiredMatchFields: ['material', 'dimensions'],

  decisionDimensions: [
    {
      key: 'build_quality',
      label: 'Build Quality',
      keywords: ['material', 'stitching', 'quality', 'wood', 'finish'],
      description: 'The materials used and how well they are joined.',
    },
    {
      key: 'comfort',
      label: 'Comfort',
      keywords: ['comfortable', 'seating', 'ergonomics', 'cushion'],
      description: 'How comfortable the piece is to sit or lie on.',
    },
    {
      key: 'durability',
      label: 'Durability',
      keywords: ['durable', 'long-lasting', 'wear', 'sagging'],
      description: 'How it holds up over years of use.',
    },
    {
      key: 'style',
      label: 'Style',
      keywords: ['style', 'design', 'aesthetic', 'looks'],
      description: 'How well it suits the room and the shopper\'s taste.',
    },
  ],

  reviewAspects: ['build_quality', 'comfort', 'durability', 'design', 'value', 'service'],

  risks: [
    {
      key: 'delivery_damage',
      label: 'Delivery Damage',
      severity: 'info',
      evaluate: () => 'Inspect upon delivery and document any issues',
    },
  ],

  ownership: {
    label: 'Furniture ownership',
    horizonYears: 10,
    note: 'Lifespan varies by type: sofas 5-10 years, beds 7-10 years, dining sets 10-20 years.',
  },

  components: [],
  safetyCritical: false,
  requiresCertification: false,
  specialised: false,
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

/* ------------------------------------------------------------------ */
/* Fashion                                                             */
/* ------------------------------------------------------------------ */

export const fashionProfile: CategoryProfile = {
  id: 'fashion' as CategoryId,
  label: 'Fashion & Apparel',
  aliases: [
    'fashion',
    'clothing',
    'apparel',
    'tshirt',
    'jeans',
    'dress',
    'kurta',
    'jacket',
    'shirt',
    'trousers',
    'lehenga',
    'saree',
  ],
  requestTerms: [
    'buy clothes',
    'fashion purchase',
    'new clothes',
    'buy a shirt',
    'buy a dress',
  ],

  specFields: [
    {
      key: 'size',
      label: 'Size',
      type: 'string',
      aliases: ['US size', 'UK size', 'EU size', 'inch', 'size'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'colour',
      label: 'Colour',
      type: 'string',
      aliases: ['colour', 'color'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'material',
      label: 'Material',
      type: 'string',
      aliases: ['fabric', 'textile', 'material type', 'upper material'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'gender',
      label: 'Gender',
      type: 'string',
      aliases: ['gender', 'department'],
      values: ['men', 'women', 'unisex', 'kids'],
      variantDefining: true,
      requiredForMatch: false,
    },
  ],
  variantFields: ['size', 'colour', 'material', 'gender'],
  requiredMatchFields: ['size', 'colour'],

  decisionDimensions: [
    {
      key: 'fit',
      label: 'Fit & Sizing',
      keywords: ['fit', 'sizing', 'runs true to size', 'runs small', 'tight'],
      description: 'How the size runs and whether it suits the shopper.',
    },
    {
      key: 'build_quality',
      label: 'Material & Stitching',
      keywords: ['material', 'stitching', 'quality', 'fabric'],
      description: 'Fabric weight and seam durability.',
    },
    {
      key: 'comfort',
      label: 'Comfort',
      keywords: ['comfort', 'cushioning', 'walk', 'all-day'],
      description: 'All-day wearability.',
    },
    {
      key: 'value',
      label: 'Value for Money',
      keywords: ['value', 'worth', 'price'],
      description: 'Cost per wear, not per purchase.',
    },
  ],

  reviewAspects: ['build_quality', 'durability', 'comfort', 'fit', 'design', 'value'],

  risks: [
    {
      key: 'size_variance',
      label: 'Size Variance Between Brands',
      severity: 'warning',
      evaluate: () =>
        'Sizes are not standardised across brands. Check return policy and compare with a pair you already own.',
    },
  ],

  ownership: {
    label: 'Fashion ownership',
    horizonYears: 3,
    note: 'Cost per wear is the honest measure for clothing and footwear.',
  },

  components: [],
  safetyCritical: false,
  requiresCertification: false,
  specialised: false,
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

/* ------------------------------------------------------------------ */
/* Beauty & personal care                                                */
/* ------------------------------------------------------------------ */

export const beautyProfile: CategoryProfile = {
  id: 'beauty' as CategoryId,
  label: 'Beauty & personal care',
  aliases: [
    'perfume',
    'fragrance',
    'skincare',
    'serum',
    'shampoo',
    'conditioner',
    'lipstick',
    'makeup',
    'deodorant',
    'sunscreen',
    'face wash',
  ],
  requestTerms: ['buy perfume', 'skincare', 'beauty product'],

  specFields: [
    {
      key: 'volumeMl',
      label: 'Volume',
      type: 'number',
      unit: 'ml',
      aliases: ['volume', 'size', 'ml'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'concentration',
      label: 'Concentration',
      type: 'string',
      aliases: ['concentration', 'fragrance family', 'type'],
      values: ['Eau de Cologne', 'Eau de Toilette', 'Eau de Parfum', 'Parfum'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'skinType',
      label: 'Skin Type',
      type: 'string',
      aliases: ['skin type', 'suitable for', 'skin'],
      values: ['dry', 'oily', 'combination', 'sensitive'],
      variantDefining: false,
      requiredForMatch: false,
    },
  ],
  variantFields: ['volumeMl', 'concentration', 'skinType'],
  requiredMatchFields: ['volumeMl'],

  decisionDimensions: [
    {
      key: 'performance',
      label: 'Performance',
      keywords: ['performance', 'longevity', 'staying power', 'effective'],
      description: 'How well the product does what it claims.',
    },
    {
      key: 'value',
      label: 'Value for Money',
      keywords: ['value', 'worth', 'price', 'cost per use'],
      description: 'Cost per use rather than per purchase.',
    },
    {
      key: 'compatibility',
      label: 'Compatibility',
      keywords: ['compatible', 'with skin type', 'for oily skin', 'suitable'],
      description: 'Whether it suits the shopper\'s skin or hair.',
    },
  ],

  reviewAspects: ['performance', 'durability', 'value', 'build_quality', 'compatibility'],

  risks: [
    {
      key: 'allergy_concerns',
      label: 'Allergy Concerns',
      severity: 'critical',
      evaluate: () =>
        'Ingredient and allergen information must come from product label. SahiPick will not infer it.',
    },
  ],

  ownership: {
    label: 'Beauty ownership',
    horizonYears: 3,
    note: 'Finished product typically finished within 6 months to 1 year of purchase.',
  },

  components: [],
  safetyCritical: true,
  requiresCertification: false,
  specialised: false,
  decisionWeights: {
    requirement: 0.3,
    product: 0.3,
    ownership: 0.2,
    financial: 0.1,
    compatibility: 0.05,
    market: 0.05,
    risk: 0.05,
    decision: 0.05,
  },
};

/* ------------------------------------------------------------------ */
/* Grocery & food                                                        */
/* ------------------------------------------------------------------ */

export const groceryProfile: CategoryProfile = {
  id: 'grocery' as CategoryId,
  label: 'Grocery & food',
  aliases: [
    'grocery',
    'food',
    'groceries',
    'essential items',
    'rice',
    'wheat flour',
    'atta',
    'dal',
    'lentils',
    'sugar',
    'oil',
    'cooking oil',
    'tea',
    'coffee',
    'milk',
    'bread',
    'eggs',
    'onion',
    'potato',
  ],
  requestTerms: ['buy groceries', 'food shopping', 'essential items', 'buy rice'],

  specFields: [
    {
      key: 'weightKg',
      label: 'Weight',
      type: 'number',
      unit: 'kg',
      aliases: ['weight', 'net weight', 'net quantity', 'quantity'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'expiryMonths',
      label: 'Shelf Life',
      type: 'number',
      unit: 'months',
      aliases: ['shelf life', 'expiry', 'best before'],
      variantDefining: true,
      requiredForMatch: true,
    },
    {
      key: 'certification',
      label: 'Certification',
      type: 'string',
      aliases: ['fssai', 'licence', 'certification', 'vegetarian'],
      variantDefining: true,
      requiredForMatch: false,
    },
  ],
  variantFields: ['weightKg', 'certification'],
  requiredMatchFields: ['weightKg', 'expiryMonths'],

  decisionDimensions: [
    {
      key: 'freshness',
      label: 'Freshness',
      keywords: ['fresh', 'organic', 'natural', 'expiry'],
      description: 'How fresh it is and how long it will keep.',
    },
    {
      key: 'value',
      label: 'Value for Money',
      keywords: ['value', 'worth', 'price per unit', 'per kg'],
      description: 'Cost per kilogram, not per pack.',
    },
  ],

  reviewAspects: ['freshness', 'value', 'accuracy'],

  risks: [
    {
      key: 'spoilage',
      label: 'Risk of Spoilage',
      severity: 'critical',
      evaluate: () => 'Always check expiry date and storage conditions',
    },
    {
      key: 'allergen_unverified',
      label: 'Allergen Information Not Verified',
      severity: 'critical',
      evaluate: () =>
        'Ingredient and allergen information for food items must come from the pack label. SahiPick will not infer it.',
    },
  ],

  ownership: {
    label: 'Everyday purchase',
    horizonYears: 0.25,
    note: 'Cost per unit is the only meaningful comparison for consumables.',
  },

  components: [],
  safetyCritical: true,
  requiresCertification: false,
  specialised: false,
  decisionWeights: {
    requirement: 0.3,
    product: 0.3,
    ownership: 0.2,
    financial: 0.1,
    compatibility: 0.05,
    market: 0.05,
    risk: 0.05,
    decision: 0.05,
  },
};
