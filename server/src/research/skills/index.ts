/**
 * Category research skills.
 *
 * A skill is a reusable research procedure: it says which searches to run,
 * which domains to trust, which facts to gather and how to read them. Skills
 * are *data*, so a new category can be researched without writing new code —
 * the orchestrator plans, executes and verifies the same way regardless.
 *
 * The searches are templates. `{brand}`, `{model}` and `{terms}` are filled
 * in with the product being researched.
 *
 * Two rules shape every skill here:
 *  - **Never** a skill asks a search engine for a price it then treats as a
 *    fact. Search results are *discovery*: they tell us which page to open.
 *    The price comes from the page.
 *  - Every skill prefers a domain that publishes the fact authoritatively
 *    (the manufacturer for specifications, the retailer for price and stock).
 */

import type { CategoryId } from '../../domain/types.ts';
import type { ResearchSkill } from '../types.ts';
import { SHOES_SKILLS } from './shoes.ts';

/** Domains that are aggregators or coupon spam — never a primary source. */
const BLOCKED_DOMAINS = [
  'amazon.in/choices',
  'flipkart.com/affiliate',
  'pinterest.com',
  'quora.com',
  'youtube.com',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'dealaggregate',
  'couponhub',
  'cashbackhub',
  'saving.com',
];

const RETAILERS = [
  'amazon.in',
  'flipkart.com',
  'croma.com',
  'reliancedigital.in',
  'vijaysales.com',
  'smartprix.com',
  '91mobiles.com',
];

const MANUFACTURERS = [
  'samsung.com',
  'apple.com',
  'oneplus.com',
  'mi.com',
  'vivo.com',
  'oppo.com',
  'realme.com',
  'lenovo.com',
  'dell.com',
  'hp.com',
  'asus.com',
  'lg.com',
  'sony.com',
];

const REVIEW_SITES = [
  'gadget360.com',
  'digit.in',
  'rtings.com',
  'notebookcheck.net',
  'gsmarena.com',
  'techradar.com',
  'indiatoday.in',
];

const COMMUNITY = [
  'reddit.com',
  'r/india',
  'r/IndianGaming',
  'r/smartphones',
  '4chan.com',
];

/* ------------------------------------------------------------------ */
/* Electronics                                                         */
/* ------------------------------------------------------------------ */

const ELECTRONICS_SKILLS: ResearchSkill[] = [
  {
    id: 'electronics.identity',
    name: 'Model and configuration identification',
    categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming'],
    objective:
      'Establish the exact model, its manufacturer part number and the configuration under test, so that listings of different variants are never conflated.',
    searches: [
      '{brand} {model} official specifications',
      '{brand} {model} part number site:{domain}',
      '{brand} {model} model number',
    ],
    preferredDomains: MANUFACTURERS,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['model_identification', 'variant_identification'],
    pagePreference: ['manufacturer', 'retailer'],
    requiresBrowser: false,
    weight: 0.95,
    notes:
      'Part numbers, SKUs and GTINs are the decisive identity signals. Prefer the manufacturer page over a retailer, which often paraphrases.',
  },
  {
    id: 'electronics.specs',
    name: 'Processor, memory, storage and display research',
    categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming'],
    objective:
      'Verify the core specifications against the manufacturer and at least one independent source.',
    searches: [
      '{brand} {model} processor RAM storage display specifications',
      '{brand} {model} full specs',
    ],
    preferredDomains: [...MANUFACTURERS, ...REVIEW_SITES],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'compatibility'],
    pagePreference: ['manufacturer', 'review_site'],
    requiresBrowser: false,
    weight: 0.85,
    notes:
      'A manufacturer specification table is authoritative. A review site is useful for the values the manufacturer omits, such as measured battery life.',
  },
  {
    id: 'electronics.compatibility',
    name: 'Compatibility and upgradeability',
    categories: ['laptop', 'smartphone', 'audio', 'camera', 'gaming'],
    objective:
      'Determine what the device is compatible with and what the owner can upgrade: RAM type, soldered components, accessory support, operating system support.',
    searches: [
      '{brand} {model} RAM upgradeable soldered slots',
      '{brand} {model} compatibility accessories',
    ],
    preferredDomains: [...MANUFACTURERS, ...REVIEW_SITES, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['compatibility', 'specification'],
    pagePreference: ['review_site', 'community', 'documentation'],
    requiresBrowser: false,
    weight: 0.8,
    notes:
      'Soldered-versus-upgradeable RAM is the single most consequential fact for a laptop buyer and is usually absent from the spec sheet. Review teardowns and community threads are the source.',
  },
  {
    id: 'electronics.battery_thermals',
    name: 'Battery, thermals and sustained performance',
    categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'gaming'],
    objective:
      'Establish real-world battery life, thermal behaviour under load and any performance throttling.',
    searches: [
      '{brand} {model} battery life test review',
      '{brand} {model} heating throttling long term review',
    ],
    preferredDomains: REVIEW_SITES,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['owner_experience', 'review_theme', 'review_complaint'],
    pagePreference: ['review_site', 'community'],
    requiresBrowser: false,
    weight: 0.75,
    notes:
      'Measured figures from review sites outrank the manufacturer claim. Record the measurement context (brightness, workload) when the source gives it.',
  },
  {
    id: 'electronics.reliability',
    name: 'Long-term reliability and common failures',
    categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming'],
    objective:
      'Identify failure modes reported by owners over time, and distinguish them from isolated complaints.',
    searches: [
      '{brand} {model} common problems long term review',
      '{brand} {model} issues after one year',
      '{brand} {model} service experience warranty complaints',
    ],
    preferredDomains: [...COMMUNITY, ...REVIEW_SITES],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['review_complaint', 'review_theme', 'owner_experience'],
    pagePreference: ['community', 'forum', 'review_site'],
    requiresBrowser: false,
    weight: 0.7,
    notes:
      'A single complaint is an anecdote. Recurrence across independent threads is the signal, and that judgement belongs to the review analysis engine, not to the fetch step.',
  },
  {
    id: 'electronics.price',
    name: 'Retailer price and offer research',
    categories: ['smartphone', 'laptop', 'tv', 'audio', 'smartwatch', 'camera', 'gaming'],
    objective:
      'Find the live listed price, availability and applicable offers at each retailer that stocks the product.',
    searches: [
      '{brand} {model} price india buy',
      '{terms} site:amazon.in',
      '{terms} site:flipkart.com',
      '{terms} site:croma.com',
    ],
    preferredDomains: RETAILERS,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['price', 'stock', 'offer', 'delivery'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
    notes:
      'Price must come from the product page, never from the search snippet. Many retailer pages render price client-side, which is why this skill may need a browser.',
  },
];

/* ------------------------------------------------------------------ */
/* Home appliances                                                     */
/* ------------------------------------------------------------------ */

const APPLIANCE_SKILLS: ResearchSkill[] = [
  {
    id: 'appliance.capacity',
    name: 'Capacity and dimensions',
    categories: ['appliance'],
    objective:
      'Establish usable capacity, external dimensions and the space the product needs.',
    searches: [
      '{brand} {model} capacity dimensions specification',
      '{brand} {model} installation dimensions clearance',
    ],
    preferredDomains: MANUFACTURERS,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'dimensions'],
    pagePreference: ['manufacturer', 'retailer'],
    requiresBrowser: false,
    weight: 0.9,
    notes:
      'For appliances the fitted dimensions and door-swing clearance matter as much as the capacity rating.',
  },
  {
    id: 'appliance.energy',
    name: 'Energy consumption and running cost',
    categories: ['appliance'],
    objective:
      'Establish the energy rating, rated power and the real running cost, then compare it with the alternatives.',
    searches: [
      '{brand} {model} energy rating power consumption',
      '{brand} {model} electricity consumption per month cost',
    ],
    preferredDomains: [...MANUFACTURERS, ...REVIEW_SITES],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'owner_experience'],
    pagePreference: ['manufacturer', 'review_site'],
    requiresBrowser: false,
    weight: 0.85,
    notes:
      'A five-star label is a claim; rated watts are a measurement. Record both and let the ownership-cost model do the arithmetic.',
  },
  {
    id: 'appliance.installation',
    name: 'Installation requirements',
    categories: ['appliance'],
    objective:
      'Establish what installation needs: plumbing, power outlet, platform, water connection, and whether it is included.',
    searches: [
      '{brand} {model} installation requirements included',
      '{brand} {model} installation charges doorstep',
    ],
    preferredDomains: [...MANUFACTURERS, 'amazon.in', 'flipkart.com', 'reliancedigital.in'],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'offer', 'review_theme'],
    pagePreference: ['manufacturer', 'retailer', 'community'],
    requiresBrowser: false,
    weight: 0.8,
    notes:
      'Installation charges change the real payable amount. Record them as a fact so the price engine can include them.',
  },
  {
    id: 'appliance.warranty_service',
    name: 'Warranty and repair availability',
    categories: ['appliance', 'furniture'],
    objective:
      'Establish the warranty split (product, motor, compressor), the service network and what the extended warranty costs.',
    searches: [
      '{brand} {model} warranty service network',
      '{brand} {model} extended warranty price',
    ],
    preferredDomains: [...MANUFACTURERS, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['warranty', 'owner_experience', 'review_theme'],
    pagePreference: ['manufacturer', 'community', 'review_site'],
    requiresBrowser: false,
    weight: 0.75,
    notes:
      'Service reach is a genuine regional concern in India and is rarely in the spec sheet; community reports are the practical source.',
  },
  {
    id: 'appliance.price',
    name: 'Retailer price, exchange and offer research',
    categories: ['appliance', 'furniture'],
    objective:
      'Find the live price, stock, delivery and any exchange or bank offer.',
    searches: [
      '{brand} {model} price india',
      '{terms} site:amazon.in',
      '{terms} site:reliancedigital.in',
      '{terms} site:croma.com',
    ],
    preferredDomains: RETAILERS,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['price', 'stock', 'offer', 'delivery'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
  },
];

/* ------------------------------------------------------------------ */
/* Fashion                                                             */
/* ------------------------------------------------------------------ */

const FASHION_SKILLS: ResearchSkill[] = [
  {
    id: 'fashion.size_fit',
    name: 'Size and fit consistency',
    categories: ['fashion'],
    objective:
      'Establish how the item fits relative to the size chart, whether the chart is accurate, and whether the fit differs between variants.',
    searches: [
      '{brand} {model} size chart fit review',
      '{brand} {model} runs small large true to size',
    ],
    preferredDomains: [...COMMUNITY, ...REVIEW_SITES, ...RETAILERS],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['owner_experience', 'review_theme', 'specification'],
    pagePreference: ['retailer', 'community', 'review_site'],
    requiresBrowser: false,
    weight: 0.85,
    notes:
      'Fit advice is only meaningful relative to the size chart and the reviewer\'s own size. Capture both when the source states them.',
  },
  {
    id: 'fashion.material',
    name: 'Fabric, material and construction',
    categories: ['fashion'],
    objective:
      'Establish the composition, the construction quality and the parts that wear out first.',
    searches: [
      '{brand} {model} fabric material composition',
      '{brand} {model} quality stitching sole review',
    ],
    preferredDomains: [...MANUFACTURERS, ...RETAILERS, ...REVIEW_SITES],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'owner_experience', 'review_theme'],
    pagePreference: ['manufacturer', 'retailer', 'review_site'],
    requiresBrowser: false,
    weight: 0.8,
  },
  {
    id: 'fashion.returns',
    name: 'Return and exchange conditions',
    categories: ['fashion'],
    objective:
      'Establish the return window, whether the item must be unworn with tags, and the reverse logistics cost.',
    searches: [
      '{brand} {model} return policy exchange',
      '{terms} return pickup charges',
    ],
    preferredDomains: RETAILERS,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['offer', 'review_theme', 'owner_experience'],
    pagePreference: ['retailer', 'community'],
    requiresBrowser: false,
    weight: 0.7,
    notes:
      'A free return window materially reduces the risk of a fashion purchase and is worth surfacing in the recommendation.',
  },
  {
    id: 'fashion.durability',
    name: 'Durability over time',
    categories: ['fashion', 'furniture'],
    objective:
      'Establish how the item holds up after months of use and which component fails first.',
    searches: [
      '{brand} {model} durability after months review',
      '{brand} {model} faded peeling quality after use',
    ],
    preferredDomains: [...COMMUNITY, ...REVIEW_SITES],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['review_complaint', 'owner_experience', 'review_theme'],
    pagePreference: ['community', 'review_site'],
    requiresBrowser: false,
    weight: 0.7,
  },
  {
    id: 'fashion.price',
    name: 'Retailer price and offer research',
    categories: ['fashion'],
    objective: 'Find the live price, size availability and applicable offers.',
    searches: [
      '{brand} {model} price buy india',
      '{terms} site:myntra.com',
      '{terms} site:ajio.com',
      '{terms} site:amazon.in',
    ],
    preferredDomains: ['myntra.com', 'ajio.com', ...RETAILERS],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['price', 'stock', 'offer', 'delivery'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
  },
];

/* ------------------------------------------------------------------ */
/* Beauty                                                              */
/* ------------------------------------------------------------------ */

const BEAUTY_SKILLS: ResearchSkill[] = [
  {
    id: 'beauty.ingredients',
    name: 'Ingredients and formulation',
    categories: ['beauty'],
    objective:
      'Establish the full ingredient list and the presence of the actives the product is marketed on.',
    searches: [
      '{brand} {model} ingredients full list',
      '{brand} {model} key actives niacinamide retinol percentage',
    ],
    preferredDomains: [...MANUFACTURERS, 'nykaa.com', 'amazon.in', 'flipkart.com'],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['ingredients', 'specification'],
    pagePreference: ['manufacturer', 'retailer'],
    requiresBrowser: false,
    weight: 0.9,
    notes:
      'The INCI list is the fact. Marketing copy is not. Where the source lists concentrations, record them; where it does not, do not infer them.',
  },
  {
    id: 'beauty.authenticity',
    name: 'Product authenticity and batch verification',
    categories: ['beauty', 'grocery'],
    objective:
      'Establish how a buyer can verify the item is genuine, and what the reported counterfeit signals are.',
    searches: [
      '{brand} {model} batch code verify authentic',
      '{brand} fake counterfeit how to check',
    ],
    preferredDomains: [...MANUFACTURERS, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['owner_experience', 'review_theme', 'certification'],
    pagePreference: ['manufacturer', 'community', 'documentation'],
    requiresBrowser: false,
    weight: 0.8,
    notes:
      'Report the verification method, not a verdict. Whether a particular item is counterfeit cannot be determined from the web.',
  },
  {
    id: 'beauty.suitability',
    name: 'Skin and hair suitability',
    categories: ['beauty'],
    objective:
      'Establish which skin or hair types the product suits, and which reactions owners report.',
    searches: [
      '{brand} {model} skin type oily dry sensitive review',
      '{brand} {model} caused irritation breakout',
    ],
    preferredDomains: [...COMMUNITY, ...REVIEW_SITES, ...RETAILERS],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['owner_experience', 'review_complaint', 'review_theme'],
    pagePreference: ['community', 'review_site', 'retailer'],
    requiresBrowser: false,
    weight: 0.8,
    notes:
      'Sensitivity reports are the highest-value evidence in this category. Surface them prominently; a cheap product that irritates is not cheap.',
  },
  {
    id: 'beauty.safety',
    name: 'Safety evidence and regulatory status',
    categories: ['beauty', 'grocery'],
    objective:
      'Establish the regulatory status (BIS, FSSAI, CDSCO) and any published safety warning.',
    searches: [
      '{brand} {model} BIS FSSAI approved certification',
      '{brand} {model} safety warning recall banned',
    ],
    preferredDomains: ['bis.gov.in', 'fssai.gov.in', ...MANUFACTURERS, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['certification', 'review_theme'],
    pagePreference: ['documentation', 'manufacturer', 'community'],
    requiresBrowser: false,
    weight: 0.85,
    notes:
      'Record the certification identifier when one is published so it can be checked independently.',
  },
  {
    id: 'beauty.price',
    name: 'Retailer price and offer research',
    categories: ['beauty'],
    objective: 'Find the live price, pack size and applicable offers.',
    searches: [
      '{brand} {model} price buy',
      '{terms} site:nykaa.com',
      '{terms} site:amazon.in',
    ],
    preferredDomains: ['nykaa.com', 'myntra.com', ...RETAILERS],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['price', 'stock', 'offer', 'delivery'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
  },
];

/* ------------------------------------------------------------------ */
/* Grocery                                                             */
/* ------------------------------------------------------------------ */

const GROCERY_SKILLS: ResearchSkill[] = [
  {
    id: 'grocery.unit_price',
    name: 'Pack size and unit pricing',
    categories: ['grocery'],
    objective:
      'Establish the pack size and compute the price per kilogram, litre or unit so like-sized products can be compared.',
    searches: [
      '{brand} {model} pack size price',
      '{terms} price per kg litre',
    ],
    preferredDomains: [...RETAILERS, 'bigbasket.com', 'jiomart.com', 'blinkit.com'],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'price'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
    notes:
      'Unit pricing is the comparison that matters. The price and the pack size are both facts; the per-unit figure is derived by the existing pricing engine.',
  },
  {
    id: 'grocery.ingredients_nutrition',
    name: 'Ingredients and nutrition information',
    categories: ['grocery'],
    objective:
      'Establish the ingredient list, nutrition per serving and any declared allergens.',
    searches: [
      '{brand} {model} nutrition facts ingredients',
      '{brand} {model} allergen ingredients declaration',
    ],
    preferredDomains: [...MANUFACTURERS, ...RETAILERS, 'fssai.gov.in'],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['ingredients', 'nutrition', 'certification'],
    pagePreference: ['manufacturer', 'retailer'],
    requiresBrowser: false,
    weight: 0.85,
  },
  {
    id: 'grocery.expiry',
    name: 'Expiry, shelf life and storage',
    categories: ['grocery'],
    objective:
      'Establish the shelf life, the storage requirement and how the expiry date is printed on the pack.',
    searches: [
      '{brand} {model} shelf life expiry date storage',
      '{brand} {model} how to check expiry',
    ],
    preferredDomains: [...MANUFACTURERS, ...RETAILERS, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'owner_experience', 'review_theme'],
    pagePreference: ['manufacturer', 'retailer', 'community'],
    requiresBrowser: false,
    weight: 0.75,
    notes:
      'Expiry is per-batch, not per-product. Record the shelf life as the fact; a specific date belongs to a specific listing.',
  },
  {
    id: 'grocery.price',
    name: 'Retailer price and delivery research',
    categories: ['grocery'],
    objective: 'Find the live price, pack size and delivery charge.',
    searches: [
      '{brand} {model} price online',
      '{terms} site:amazon.in',
      '{terms} site:bigbasket.com',
    ],
    preferredDomains: ['bigbasket.com', 'jiomart.com', ...RETAILERS],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['price', 'stock', 'delivery', 'offer'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
  },
];

/* ------------------------------------------------------------------ */
/* Furniture                                                           */
/* ------------------------------------------------------------------ */

const FURNITURE_SKILLS: ResearchSkill[] = [
  {
    id: 'furniture.dimensions_material',
    name: 'Dimensions, material and assembly',
    categories: ['furniture'],
    objective:
      'Establish the assembled dimensions, the material and whether assembly is included.',
    searches: [
      '{brand} {model} dimensions material assembly',
      '{brand} {model} wood type finish',
    ],
    preferredDomains: [...RETAILERS, 'urbancompany.com', 'pepperfry.com', 'ikea.com'],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['specification', 'dimensions', 'review_theme'],
    pagePreference: ['retailer', 'manufacturer'],
    requiresBrowser: false,
    weight: 0.85,
  },
  {
    id: 'furniture.delivery_assembly',
    name: 'Delivery and assembly charges',
    categories: ['furniture'],
    objective:
      'Establish the delivery timeline, the assembly charge and the damage-in-transit policy.',
    searches: [
      '{brand} {model} delivery time assembly charges',
      '{terms} damage in transit return policy furniture',
    ],
    preferredDomains: [...RETAILERS, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['delivery', 'offer', 'review_theme', 'owner_experience'],
    pagePreference: ['retailer', 'community'],
    requiresBrowser: false,
    weight: 0.8,
    notes:
      'Furniture delivery and assembly costs are large enough to change which product is cheapest. They belong in the payable price.',
  },
  {
    id: 'furniture.quality',
    name: 'Build quality and long-term comfort',
    categories: ['furniture'],
    objective:
      'Establish build quality, comfort over long use and the complaints that recur.',
    searches: [
      '{brand} {model} quality review comfortable long use',
      '{brand} {model} complaints wobble finish',
    ],
    preferredDomains: [...COMMUNITY, ...REVIEW_SITES],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['owner_experience', 'review_complaint', 'review_theme'],
    pagePreference: ['community', 'review_site'],
    requiresBrowser: false,
    weight: 0.75,
  },
  {
    id: 'furniture.price',
    name: 'Retailer price and offer research',
    categories: ['furniture'],
    objective: 'Find the live price, delivery charge and applicable offers.',
    searches: [
      '{brand} {model} price buy india',
      '{terms} site:amazon.in',
      '{terms} site:flipkart.com',
    ],
    preferredDomains: RETAILERS,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['price', 'stock', 'delivery', 'offer'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
  },
];

/* ------------------------------------------------------------------ */
/* Automotive                                                          */
/* ------------------------------------------------------------------ */

const AUTOMOTIVE_SKILLS: ResearchSkill[] = [
  {
    id: 'automotive.part_number',
    name: 'Exact part number identification',
    categories: ['automotive'],
    objective:
      'Establish the exact manufacturer part number, its revisions and the OEM reference for it.',
    searches: [
      '{brand} {model} part number oem cross reference',
      '{brand} {model} part number supersession',
    ],
    preferredDomains: [...MANUFACTURERS, 'partsofsource.com', 'autodoc.in', 'amazon.in'],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['variant_identification', 'compatibility'],
    pagePreference: ['manufacturer', 'documentation', 'retailer'],
    requiresBrowser: false,
    weight: 0.95,
    notes:
      'A part number that has been superseded is the classic way to buy the wrong part. Record supersession chains when they are published.',
  },
  {
    id: 'automotive.compatibility',
    name: 'Vehicle compatibility',
    categories: ['automotive'],
    objective:
      'Establish which vehicles, model years and variants the part fits, and which it does not.',
    searches: [
      '{brand} {model} fits which vehicles compatibility list',
      '{brand} {model} fitment year variant',
    ],
    preferredDomains: [...MANUFACTURERS, 'partsofsource.com', 'autodoc.in', ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['compatibility', 'certification'],
    pagePreference: ['documentation', 'retailer', 'community'],
    requiresBrowser: false,
    weight: 0.95,
    notes:
      'Fitment must be stated at year-and-variant granularity. "Fits all models" is a red flag, not a fitment list.',
  },
  {
    id: 'automotive.safety',
    name: 'Safety certification',
    categories: ['automotive'],
    objective:
      'Establish the safety certification (BIS/ISI, ECE, DOT) and the test standard the part meets.',
    searches: [
      '{brand} {model} BIS ISI certified ECE standard',
      '{brand} {model} safety standard test certification',
    ],
    preferredDomains: ['bis.gov.in', ...MANUFACTURERS, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['certification', 'specification'],
    pagePreference: ['documentation', 'manufacturer', 'community'],
    requiresBrowser: false,
    weight: 0.9,
    notes:
      'For safety-critical parts a missing certification is disqualifying. Record the certification number where published.',
  },
  {
    id: 'automotive.warranty',
    name: 'Warranty and installation',
    categories: ['automotive'],
    objective:
      'Establish the warranty period, whether installation is required, and the expected labour.',
    searches: [
      '{brand} {model} warranty installation professional fitment',
      '{brand} {model} how to install diy',
    ],
    preferredDomains: [...MANUFACTURERS, ...RETAILERS, ...COMMUNITY],
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['warranty', 'offer', 'review_theme'],
    pagePreference: ['manufacturer', 'retailer', 'community'],
    requiresBrowser: false,
    weight: 0.8,
  },
  {
    id: 'automotive.price',
    name: 'Retailer price and offer research',
    categories: ['automotive'],
    objective: 'Find the live price, stock and applicable offers.',
    searches: [
      '{brand} {model} price buy india',
      '{terms} site:amazon.in',
      '{terms} site:flipkart.com',
    ],
    preferredDomains: RETAILERS,
    blockedDomains: BLOCKED_DOMAINS,
    factKinds: ['price', 'stock', 'offer', 'delivery'],
    pagePreference: ['retailer'],
    requiresBrowser: true,
    weight: 0.9,
  },
];

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const ALL_SKILLS: ResearchSkill[] = [
  ...ELECTRONICS_SKILLS,
  ...APPLIANCE_SKILLS,
  ...FASHION_SKILLS,
  ...BEAUTY_SKILLS,
  ...GROCERY_SKILLS,
  ...FURNITURE_SKILLS,
  ...AUTOMOTIVE_SKILLS,
  ...SHOES_SKILLS,
];

const byCategory = new Map<CategoryId, ResearchSkill[]>();
for (const skill of ALL_SKILLS) {
  for (const category of skill.categories) {
    const list = byCategory.get(category) ?? [];
    list.push(skill);
    byCategory.set(category, list);
  }
}

/** Every registered skill. */
export function allSkills(): ResearchSkill[] {
  return ALL_SKILLS;
}

/** The skills that apply to a category. */
export function skillsForCategory(category: CategoryId): ResearchSkill[] {
  return byCategory.get(category) ?? [];
}

/** A skill by id. */
export function skillById(id: string): ResearchSkill | undefined {
  return ALL_SKILLS.find((skill) => skill.id === id);
}

/** The categories that have at least one skill. */
export function categoriesWithSkills(): CategoryId[] {
  return [...byCategory.keys()];
}
