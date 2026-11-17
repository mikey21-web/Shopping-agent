/**
 * The footwear sample catalogue.
 *
 * These are the bundled sample listings the platform ships with. They are
 * clearly labelled as sample data everywhere they surface, and the
 * decision engine's sample-pricing note says so. They exist so the
 * category framework can be exercised for footwear without a live
 * retailer feed.
 *
 * The owner reviews are written to contain the complaints and the praise
 * that actually recur in this category — sizing that runs small, soles
 * that separate, stitching that gives way, and comfort that holds up
 * over months — so the ownership analysis has something real to find.
 */

import type { SeedListing, SeedOffer, SeedProduct, SeedReview } from './sample-catalogue.ts';

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export const SAMPLE_SHOES: SeedProduct[] = [
  {
    id: 'prod-pegasus41',
    brand: 'Nike',
    model: 'Air Zoom Pegasus 41',
    displayName: 'Nike Air Zoom Pegasus 41',
    category: 'shoes',
    generation: '2025',
    imageUrl:
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80&auto=format&fit=crop',
    highlights: [
      'Zoom Air cushioning',
      'ReactX foam midsole',
      'Engineered mesh upper',
      'Rubber waffle outsole',
      '288g per shoe (UK 9)',
    ],
    variants: [
      {
        label: 'UK 9 / Black / Men',
        specs: {
          Size: 'UK 9',
          'Size Standard': 'UK/US',
          Width: 'Standard',
          'Upper Material': 'Engineered Mesh',
          'Midsole Material': 'ReactX Foam',
          'Outsole Material': 'Rubber',
          'Sole Thickness': '10 mm',
          Weight: '288 g',
          Gender: 'Men',
          Colour: 'Black',
          Surface: 'Road',
          Warranty: '6 months manufacturing',
        },
        partNumber: 'DV3068-001',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-ultraboost22',
    brand: 'Adidas',
    model: 'Ultraboost 22',
    displayName: 'Adidas Ultraboost 22',
    category: 'shoes',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=600&q=80&auto=format&fit=crop',
    highlights: [
      'Boost midsole',
      'Primeknit+ upper',
      'Continuum rubber outsole',
      '12 mm heel-to-toe drop',
      '295g per shoe (UK 9)',
    ],
    variants: [
      {
        label: 'UK 9 / Core Black / Men',
        specs: {
          Size: 'UK 9',
          'Size Standard': 'UK/US',
          Width: 'Standard',
          'Upper Material': 'Primeknit+',
          'Midsole Material': 'Boost',
          'Outsole Material': 'Continuum Rubber',
          'Sole Thickness': '12 mm',
          Weight: '295 g',
          Gender: 'Men',
          Colour: 'Core Black',
          Surface: 'Road',
          Warranty: '6 months manufacturing',
        },
        partNumber: 'B45530',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-novablast4',
    brand: 'ASICS',
    model: 'Novablast 4',
    displayName: 'ASICS Novablast 4',
    category: 'shoes',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=600&q=80&auto=format&fit=crop',
    highlights: [
      'FF BLAST midsole',
      'ASICSGRIP outsole',
      'Woven upper',
      '9 mm drop',
      '253g per shoe (UK 9)',
    ],
    variants: [
      {
        label: 'UK 9 / Pure Silver / Men',
        specs: {
          Size: 'UK 9',
          'Size Standard': 'UK/US',
          Width: 'Standard',
          'Upper Material': 'Woven',
          'Midsole Material': 'FF BLAST',
          'Outsole Material': 'ASICSGRIP Rubber',
          'Sole Thickness': '9 mm',
          Weight: '253 g',
          Gender: 'Men',
          Colour: 'Pure Silver',
          Surface: 'Road',
          Warranty: '6 months manufacturing',
        },
        partNumber: '1011B544-101',
        colour: 'silver',
      },
    ],
  },
  {
    id: 'prod-ghost13',
    brand: 'Puma',
    model: 'Ghost 13',
    displayName: 'Puma Ghost 13',
    category: 'shoes',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=600&q=80&auto=format&fit=crop',
    highlights: [
      'NITRO Foam midsole',
      'Engineered mesh upper',
      'Rubber outsole',
      '8 mm drop',
      '268g per shoe (UK 9)',
    ],
    variants: [
      {
        label: 'UK 9 / Puma Black / Men',
        specs: {
          Size: 'UK 9',
          'Size Standard': 'UK/US',
          Width: 'Standard',
          'Upper Material': 'Engineered Mesh',
          'Midsole Material': 'NITRO Foam',
          'Outsole Material': 'Rubber',
          'Sole Thickness': '8 mm',
          Weight: '268 g',
          Gender: 'Men',
          Colour: 'Puma Black',
          Surface: 'Road',
          Warranty: '6 months manufacturing',
        },
        partNumber: '376914-02',
        colour: 'black',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Listings                                                            */
/* ------------------------------------------------------------------ */

export const SAMPLE_SHOES_LISTINGS: SeedListing[] = [
  {
    id: 'lst-pegasus41-myntra',
    productId: 'prod-pegasus41',
    variantIndex: 0,
    retailer: 'myntra',
    retailerProductId: 'MV-PE41-BLK',
    title: "Nike Air Zoom Pegasus 41 Men's Running Shoes - Black",
    url: 'https://www.myntra.com/nike-air-zoom-pegasus-41-running-shoes',
    listPricePaise: 499900,
    mrpPaise: 699900,
    rating: 4.3,
    ratingCount: 1240,
    reviewCount: 1240,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-pegasus41-amazon',
    productId: 'prod-pegasus41',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0D8PE41BLK',
    title: 'Nike Air Zoom Pegasus 41 Running Shoes for Men (Black, UK 9)',
    url: 'https://www.amazon.in/dp/B0D8PE41BLK',
    listPricePaise: 519900,
    mrpPaise: 699900,
    rating: 4.2,
    ratingCount: 830,
    reviewCount: 830,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-ultraboost22-flipkart',
    productId: 'prod-ultraboost22',
    variantIndex: 0,
    retailer: 'flipkart',
    retailerProductId: 'ADUB22-BLK-9',
    title: 'Adidas Ultraboost 22 Men Running Shoes - Core Black',
    url: 'https://www.flipkart.com/adidas-ultraboost-22-running-shoes',
    listPricePaise: 449900,
    mrpPaise: 999900,
    rating: 4.4,
    ratingCount: 3120,
    reviewCount: 3120,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-novablast4-decathlon',
    productId: 'prod-novablast4',
    variantIndex: 0,
    retailer: 'decathlon',
    retailerProductId: 'DC-1011B544',
    title: 'ASICS Novablast 4 Running Shoes - Men',
    url: 'https://www.decathlon.in/asics-novablast-4-running-shoes',
    listPricePaise: 479900,
    mrpPaise: 599900,
    rating: 4.3,
    ratingCount: 640,
    reviewCount: 640,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-ghost13-roadster',
    productId: 'prod-ghost13',
    variantIndex: 0,
    retailer: 'roadster',
    retailerProductId: 'RD-376914-02',
    title: 'Puma Ghost 13 Men Running Shoes - Black',
    url: 'https://www.roadster.in/puma-ghost-13-running-shoes',
    listPricePaise: 299900,
    mrpPaise: 449900,
    rating: 3.9,
    ratingCount: 410,
    reviewCount: 410,
    deliveryFeePaise: 9900,
  },
];

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

export const SAMPLE_SHOES_OFFERS: SeedOffer[] = [
  {
    listingId: 'lst-pegasus41-myntra',
    kind: 'bank_discount',
    title: '10% instant discount on HDFC Bank credit card',
    description: 'Maximum discount Rs 500',
    percentOff: 10,
    bank: 'HDFC Bank',
    cardType: 'credit',
    maxDiscountPaise: 50000,
  },
  {
    listingId: 'lst-pegasus41-amazon',
    kind: 'cashback',
    title: '10% back on Amazon Pay UPI',
    description: 'Maximum Rs 600 back',
    cashbackPaise: 51990,
  },
  {
    listingId: 'lst-ultraboost22-flipkart',
    kind: 'exchange',
    title: 'Extra 10% off on exchange of your old running shoes',
    description: 'Maximum Rs 1500 exchange bonus',
    requiresExchange: true,
    exchangeBonusPaise: 44990,
  },
  {
    listingId: 'lst-novablast4-decathlon',
    kind: 'coupon',
    title: 'FLAT500 off above Rs 3,000',
    description: 'Minimum spend Rs 3,000',
    flatOffPaise: 50000,
    minSpendPaise: 300000,
  },
];

/* ------------------------------------------------------------------ */
/* Owner reviews                                                        */
/* ------------------------------------------------------------------ */

/**
 * The owner reviews.
 *
 * The complaints here are the ones that recur in this category — sizing
 * that runs small, soles that separate, stitching that gives way — and
 * the praise is the comfort and durability that owners report when a
 * shoe works. The ownership analysis is expected to find these patterns
 * and to report them as counts of what was actually observed.
 */
export const SAMPLE_SHOES_REVIEWS: SeedReview[] = [
  // Pegasus 41 — comfortable and light, but the sizing runs small.
  {
    listingId: 'lst-pegasus41-myntra',
    rating: 4,
    title: 'Very comfortable, but order a size up',
    body: 'These are very comfortable for long runs. The cushioning is excellent and the shoe is lighter than my old pair. However the size runs small — I had to exchange for a half size up. The size chart on the listing is not accurate.',
    verifiedPurchase: true,
    daysAgo: 42,
    language: 'en',
    helpfulVotes: 67,
  },
  {
    listingId: 'lst-pegasus41-myntra',
    rating: 4,
    title: 'Great daily trainer',
    body: 'Excellent build quality, very comfortable, and the grip is good on wet roads. Took about a week to break in. Now I wear them for everything.',
    verifiedPurchase: true,
    daysAgo: 88,
    language: 'en',
    helpfulVotes: 34,
  },
  {
    listingId: 'lst-pegasus41-myntra',
    rating: 2,
    title: 'Sole came apart in two months',
    body: 'Disappointed. After two months of normal use the sole came apart from the upper at the toe. The build quality looked good at first. The sole separated right along the glue line. Warranty claim was rejected.',
    verifiedPurchase: true,
    daysAgo: 61,
    language: 'en',
    helpfulVotes: 91,
  },
  {
    listingId: 'lst-pegasus41-myntra',
    rating: 3,
    title: 'Comfortable but not durable',
    body: 'Very comfortable and lightweight, genuinely. But after three months the sole wore out and the outsole is now smooth. The stitching is starting to go at the heel too. Good for light use, not for daily running.',
    verifiedPurchase: false,
    daysAgo: 130,
    language: 'en',
    helpfulVotes: 22,
  },
  {
    listingId: 'lst-pegasus41-amazon',
    rating: 5,
    title: 'Perfect fit and very comfortable',
    body: 'True to size for me, no exchange needed. Very comfortable from day one, no break-in at all. The cushioning is excellent and the shoe is surprisingly light.',
    verifiedPurchase: true,
    daysAgo: 25,
    language: 'en',
    helpfulVotes: 18,
  },
  {
    listingId: 'lst-pegasus41-amazon',
    rating: 2,
    title: 'Runs small and too tight',
    body: 'Too small and too tight. The size chart is wrong, they run small. Had to return. The shoe itself looks well made but the fit is not right for narrow feet.',
    verifiedPurchase: true,
    daysAgo: 73,
    language: 'en',
    helpfulVotes: 29,
  },
  {
    listingId: 'lst-pegasus41-amazon',
    rating: 4,
    title: 'Good grip and comfortable',
    body: 'Very comfortable for all-day wear. Grip is excellent even on wet roads. Lightweight too. Would buy again.',
    verifiedPurchase: true,
    daysAgo: 110,
    language: 'en',
    helpfulVotes: 11,
  },

  // Ultraboost 22 — the comfort benchmark, and the durability problem.
  {
    listingId: 'lst-ultraboost22-flipkart',
    rating: 5,
    title: 'Best cushioning I have had',
    body: 'The cushioning is out of this world and it is very comfortable for hours. Excellent build quality and great grip. Lightweight for a shoe with this much foam.',
    verifiedPurchase: true,
    daysAgo: 30,
    language: 'en',
    helpfulVotes: 145,
  },
  {
    listingId: 'lst-ultraboost22-flipkart',
    rating: 2,
    title: 'Sole separated after three months',
    body: 'The sole came apart from the upper after three months. Very disappointed given the price. The outsole peeled away completely. Stitching was also poor near the heel.',
    verifiedPurchase: true,
    daysAgo: 55,
    language: 'en',
    helpfulVotes: 203,
  },
  {
    listingId: 'lst-ultraboost22-flipkart',
    rating: 1,
    title: 'Fell apart in six weeks',
    body: 'Fell apart in six weeks of casual wear. The sole separated and the stitching came apart at the same time. Not worth the price for something that lasted less than two months.',
    verifiedPurchase: true,
    daysAgo: 95,
    language: 'en',
    helpfulVotes: 178,
  },
  {
    listingId: 'lst-ultraboost22-flipkart',
    rating: 4,
    title: 'Superb ride, poor longevity',
    body: 'Very comfortable and the cushioning is superb. Genuinely the softest shoe I own. But the sole wear is quick — after four months the midsole is flat and the outsole is smooth.',
    verifiedPurchase: true,
    daysAgo: 150,
    language: 'en',
    helpfulVotes: 76,
  },
  {
    listingId: 'lst-ultraboost22-flipkart',
    rating: 3,
    title: 'Too small and too tight',
    body: 'Runs small. The size chart is wrong and they are too tight across the forefoot. Very comfortable once you get used to them, but I had to exchange for a size up.',
    verifiedPurchase: false,
    daysAgo: 120,
    language: 'en',
    helpfulVotes: 44,
  },

  // Pegasus 40 — the value option, lighter but less cushioned.
  {
    listingId: 'lst-pegasus40-amazon',
    rating: 4,
    title: 'Great value, comfortable',
    body: 'Excellent value for money. Very comfortable for the price and lightweight. The cushioning is good enough for daily running. Runs true to size for me.',
    verifiedPurchase: true,
    daysAgo: 38,
    language: 'en',
    helpfulVotes: 52,
  },
  {
    listingId: 'lst-pegasus40-amazon',
    rating: 3,
    title: 'Fine for walking, thin for running',
    body: 'Comfortable enough for walking and light on the foot, but the cushioning is thin for running. No grip issues. The build quality is fine for the price.',
    verifiedPurchase: true,
    daysAgo: 82,
    language: 'en',
    helpfulVotes: 21,
  },
  {
    listingId: 'lst-pegasus40-amazon',
    rating: 4,
    title: 'Lightweight and holds up',
    body: 'Very lightweight compared to my last pair and the sole has held up well after five months of daily wear. Grip is good. Comfortable.',
    verifiedPurchase: true,
    daysAgo: 160,
    language: 'en',
    helpfulVotes: 15,
  },
  {
    listingId: 'lst-pegasus40-amazon',
    rating: 2,
    title: 'Ran small for me',
    body: 'Too small. Runs small and the size chart is wrong. My usual size was tight so I ordered a size up and it was too big. Very frustrating.',
    verifiedPurchase: false,
    daysAgo: 100,
    language: 'en',
    helpfulVotes: 27,
  },

  // Novablast 4 — the durability pick, heavier but lasting.
  {
    listingId: 'lst-novablast4-decathlon',
    rating: 5,
    title: 'Built to last',
    body: 'Excellent build quality and very sturdy. After six months of daily running the sole has barely worn. Comfortable from the start and the grip is excellent. Worth every rupee.',
    verifiedPurchase: true,
    daysAgo: 20,
    language: 'en',
    helpfulVotes: 89,
  },
  {
    listingId: 'lst-novablast4-decathlon',
    rating: 4,
    title: 'Durable but not the softest',
    body: 'Sturdy shoe and the outsole is holding up well. The cushioning is firm rather than soft, so if you want a plush ride this is not it. Grip is very good. Lightweight for a durable trainer.',
    verifiedPurchase: true,
    daysAgo: 70,
    language: 'en',
    helpfulVotes: 41,
  },
  {
    listingId: 'lst-novablast4-decathlon',
    rating: 4,
    title: 'Good value, lasted a year',
    body: 'Great value for money and the shoe is still going strong after a year. Not the most comfortable shoe, but the durability is the point. True to size.',
    verifiedPurchase: true,
    daysAgo: 200,
    language: 'en',
    helpfulVotes: 33,
  },
  {
    listingId: 'lst-novablast4-decathlon',
    rating: 3,
    title: 'Runs small, sizing is a guess',
    body: 'Sizing is awkward — the size chart is wrong and they run small. The shoe itself is very sturdy and comfortable once you have the right size.',
    verifiedPurchase: true,
    daysAgo: 55,
    language: 'en',
    helpfulVotes: 12,
  },

  // Ghost 13 — the cheap one, and the complaints follow.
  {
    listingId: 'lst-ghost13-roadster',
    rating: 3,
    title: 'Fine for the price',
    body: 'Comfortable enough and lightweight, and the value for money is good. Grip is fine on dry roads. The build quality is basic but acceptable.',
    verifiedPurchase: true,
    daysAgo: 45,
    language: 'en',
    helpfulVotes: 9,
  },
  {
    listingId: 'lst-ghost13-roadster',
    rating: 2,
    title: 'Sole came apart in a month',
    body: 'The sole came apart after about a month of light wear. Poor stitching at the heel as well. Not worth the money when it falls apart that quickly.',
    verifiedPurchase: true,
    daysAgo: 65,
    language: 'en',
    helpfulVotes: 24,
  },
  {
    listingId: 'lst-ghost13-roadster',
    rating: 3,
    title: 'Runs small',
    body: 'Too small and the size chart does not match. Comfortable once it fits but it took two exchanges to get the right size.',
    verifiedPurchase: false,
    daysAgo: 110,
    language: 'en',
    helpfulVotes: 7,
  },
];
