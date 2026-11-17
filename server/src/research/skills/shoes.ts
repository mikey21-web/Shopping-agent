/**
 * The footwear research skills.
 *
 * A shoe research mission has to answer different questions from a
 * laptop research mission. The specification sheet is thin — a shoe is
 * "mesh upper, rubber outsole, EVA midsole" — so the decisive evidence
 * is elsewhere:
 *
 *  - **The manufacturer page**, for the exact model, the sizes offered
 *    and the technology in the midsole.
 *  - **The retailer listing**, for the price, the stock and the sizes
 *    actually on sale. These differ from the manufacturer price.
 *  - **Independent reviews**, for the fit, the comfort over hours and
 *    how the sole wore.
 *  - **Community discussions**, for the long-term experience: does the
 *    sole separate, does the size run small, is it worth the money.
 *  - **The running-specialist press**, for the measurable performance
 *    numbers that a retailer never publishes.
 *
 * Each skill here targets one of those.
 */

import type { ResearchSkill } from '../types.ts';

/* ------------------------------------------------------------------ */
/* The skills                                                           */
/* ------------------------------------------------------------------ */

/** The exact model, its sizes and its construction. */
const SHOE_SPECIFICATION_SKILL: ResearchSkill = {
  id: 'shoes.specification',
  name: 'Footwear specifications',
  categories: ['shoes'],
  objective:
    'Establish the exact model, the sizes offered, the upper and sole materials, the cushioning technology and the weight of the shoe.',
  searches: [
    '{brand} {model} official specifications',
    '{brand} {model} midsole outsole weight',
    'site:{brand}.com {model} {variant}',
    '{brand} {model} size chart measurements',
  ],
  preferredDomains: [
    'nike.com',
    'adidas.com',
    'puma.com',
    'skechers.com',
    'newbalance.com',
    'asics.com',
    'mizuno.com',
    'saucony.com',
    'hoka.com',
    'on.com',
    'decathlon.in',
    'roadster.in',
    'redtape.com',
    'bata.com',
    'libas.com',
  ],
  blockedDomains: ['amazon.in', 'flipkart.com', 'myntra.com', 'slickdeals.net', 'dealclatter.com'],
  factKinds: ['model_identification', 'variant_identification', 'specification'],
  pagePreference: ['manufacturer', 'retailer', 'review_site'],
  requiresBrowser: false,
  weight: 0.95,
  notes:
    'The size chart matters more here than in any other category. A shoe at UK 9 and a shoe at UK 10 are different sellable items, and the published size chart is frequently wrong.',
};

/** The price, the stock and the sizes on sale. */
const SHOE_PRICE_SKILL: ResearchSkill = {
  id: 'shoes.price',
  name: 'Footwear price and availability',
  categories: ['shoes'],
  objective:
    'Find the price the buyer actually pays at each retailer, the sizes in stock, and the discount that is running.',
  searches: [
    '{brand} {model} price buy online India',
    '{brand} {model} {variant} price flipkart amazon',
    '{brand} {model} discount sale offer',
    'buy {brand} {model} shoes online India',
  ],
  preferredDomains: [
    'amazon.in',
    'flipkart.com',
    'myntra.com',
    'ajio.com',
    'tatacliq.com',
    'reliancedigital.in',
    'croma.com',
    'decathlon.in',
    'roadster.in',
    'paytmmall.com',
  ],
  blockedDomains: ['slickdeals.net', 'dealclatter.com', 'couponpedia.in'],
  factKinds: ['price', 'offer', 'stock', 'delivery'],
  pagePreference: ['retailer'],
  requiresBrowser: true,
  weight: 0.9,
  notes:
    'Footwear prices vary by size as well as by retailer, because the smaller sizes sell out first. The price must be tied to the size the buyer wants.',
};

/** The fit, and whether the size runs true. */
const SHOE_FIT_SKILL: ResearchSkill = {
  id: 'shoes.fit',
  name: 'Footwear fit and sizing',
  categories: ['shoes'],
  objective:
    'Establish whether the shoe runs small, large or true to size, whether the width is narrow or wide, and how it compares to a shoe the buyer already owns.',
  searches: [
    '{brand} {model} sizing review runs small true to size',
    '{brand} {model} fit narrow wide review',
    '{brand} {model} half size up sizing advice',
    '{brand} {model} how does it fit compared to',
  ],
  preferredDomains: [
    'reddit.com',
    'shoeheroes.com',
    'runrepeat.com',
    'walmart.com',
    'amazon.in',
    'flipkart.com',
    'soleandlounge.com',
  ],
  blockedDomains: ['slickdeals.net'],
  factKinds: ['review_theme', 'owner_experience', 'review_complaint'],
  pagePreference: ['community', 'review_site', 'retailer'],
  requiresBrowser: false,
  weight: 0.95,
  notes:
    'This is the highest-value skill in the category. A shoe that fits badly is worthless no matter what else it does well.',
};

/** The comfort over hours, and the cushioning in practice. */
const SHOE_COMFORT_SKILL: ResearchSkill = {
  id: 'shoes.comfort',
  name: 'Footwear comfort and cushioning',
  categories: ['shoes'],
  objective:
    'Establish how the shoe feels over hours of wear, how much the midsole gives back after mileage, and whether it needs breaking in.',
  searches: [
    '{brand} {model} long term comfort review after months',
    '{brand} {model} cushioning review hours walking',
    '{brand} {model} break in period comfortable from day one',
    '{brand} {model} all day wear experience',
  ],
  preferredDomains: [
    'reddit.com',
    'runrepeat.com',
    'shoeheroes.com',
    'youtube.com',
    'gq.com',
    'outsideonline.com',
    'fleetfooter.com',
  ],
  blockedDomains: ['slickdeals.net'],
  factKinds: ['review_theme', 'owner_experience', 'review_complaint'],
  pagePreference: ['review_site', 'community'],
  requiresBrowser: false,
  weight: 0.9,
  notes:
    'The break-in period is a real cost that shoppers rarely account for. A shoe that needs a month to become comfortable is a month of discomfort.',
};

/** The durability, and the failure modes. */
const SHOE_DURABILITY_SKILL: ResearchSkill = {
  id: 'shoes.durability',
  name: 'Footwear durability and sole wear',
  categories: ['shoes'],
  objective:
    'Establish how the outsole and the stitching hold up over months, whether the sole separates, and how many kilometres or months the buyer can expect.',
  searches: [
    '{brand} {model} durability sole wear months review',
    '{brand} {model} sole separated came apart',
    '{brand} {model} how long do they last kilometres miles',
    '{brand} {model} stitching quality complaints',
  ],
  preferredDomains: [
    'reddit.com',
    'runrepeat.com',
    'shoeheroes.com',
    'amazon.in',
    'flipkart.com',
  ],
  blockedDomains: ['slickdeals.net'],
  factKinds: ['review_theme', 'review_complaint', 'owner_experience', 'warranty'],
  pagePreference: ['community', 'review_site'],
  requiresBrowser: false,
  weight: 0.9,
  notes:
    'Sole separation is the failure that ends a shoe purchase early. It is a construction fault, not a preference, and the warranty may or may not cover it.',
};

/** The grip and the surface it was designed for. */
const SHOE_GRIP_SKILL: ResearchSkill = {
  id: 'shoes.grip',
  name: 'Footwear grip and traction',
  categories: ['shoes'],
  objective:
    'Establish how the outsole behaves on wet, dry and uneven ground, and whether the traction pattern suits the surface the buyer will use it on.',
  searches: [
    '{brand} {model} grip traction wet road review',
    '{brand} {model} outsole rubber tread pattern',
    '{brand} {model} slippery outsole complaint',
  ],
  preferredDomains: ['runrepeat.com', 'shoeheroes.com', 'reddit.com', 'trailrunmag.com'],
  blockedDomains: ['slickdeals.net'],
  factKinds: ['specification', 'review_theme', 'review_complaint'],
  pagePreference: ['review_site', 'community'],
  requiresBrowser: false,
  weight: 0.75,
};

/** The return and exchange policy, which decides whether fit risk is acceptable. */
const SHOE_POLICY_SKILL: ResearchSkill = {
  id: 'shoes.policy',
  name: 'Footwear return and warranty policy',
  categories: ['shoes'],
  objective:
    'Establish the return window, whether the buyer can try the shoes indoors, and what the warranty covers.',
  searches: [
    '{brand} {model} return policy exchange India',
    'site:{brand}.com warranty return policy footwear',
    '{brand} {model} warranty manufacturing defect',
  ],
  preferredDomains: [
    'nike.com',
    'adidas.com',
    'decathlon.in',
    'bata.com',
    'redtape.com',
    'amazon.in',
    'flipkart.com',
  ],
  blockedDomains: ['slickdeals.net'],
  factKinds: ['warranty', 'delivery'],
  pagePreference: ['manufacturer', 'retailer', 'documentation'],
  requiresBrowser: false,
  weight: 0.8,
  notes:
    'The return window is what makes the fit question survivable. A shoe with no return window and an uncertain fit is a gamble, and the decision should say so.',
};

/** The independent performance testing. */
const SHOE_TEST_SKILL: ResearchSkill = {
  id: 'shoes.test',
  name: 'Independent footwear testing',
  categories: ['shoes'],
  objective:
    'Find independent laboratory or specialist-press measurements: stack height, drop, weight, energy return and durability testing.',
  searches: [
    '{brand} {model} lab test stack height drop weight',
    '{brand} {model} review outsole durability test',
    '{brand} {model} independent review comparison',
  ],
  preferredDomains: [
    'runrepeat.com',
    'notebookcheck.net',
    'techradar.com',
    'outsideonline.com',
    'trailrunmag.com',
    'dcrainmaker.com',
    'wareable.com',
  ],
  blockedDomains: ['amazon.in', 'flipkart.com', 'myntra.com'],
  factKinds: ['specification', 'review_theme'],
  pagePreference: ['review_site'],
  requiresBrowser: false,
  weight: 0.85,
  notes:
    'Specialist reviewers publish the numbers a retailer never does. This is the source for weight, stack height and drop, which decide whether a shoe suits the intended use.',
};

/** Every footwear skill. */
export const SHOES_SKILLS: ResearchSkill[] = [
  SHOE_SPECIFICATION_SKILL,
  SHOE_PRICE_SKILL,
  SHOE_FIT_SKILL,
  SHOE_COMFORT_SKILL,
  SHOE_DURABILITY_SKILL,
  SHOE_GRIP_SKILL,
  SHOE_POLICY_SKILL,
  SHOE_TEST_SKILL,
];
