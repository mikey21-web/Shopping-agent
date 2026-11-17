/**
 * Bundled sample catalogue.
 *
 * IMPORTANT: every record produced here carries `origin: 'sample'`. It is
 * authored demonstration data, not live retailer data, and the API/UI label it
 * as such. It exists so the intelligence engine can be exercised end to end
 * (matching, offers, price history, review analysis, recommendations) without
 * any retailer credentials.
 *
 * The data is generated deterministically from a fixed seed so that tests and
 * screenshots are reproducible.
 */

import type {
  CategoryId,
  ListingCondition,
  OfferKind,
  OfferStackability,
  RetailerId,
  ReviewLanguage,
} from '../domain/types.ts';

/* ------------------------------------------------------------------ */
/* Deterministic PRNG                                                  */
/* ------------------------------------------------------------------ */

/** mulberry32 — small, fast, deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261113);
const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick() called with an empty list');
  return item;
};
const pickInt = (min: number, max: number): number => Math.floor(random() * (max - min + 1)) + min;

/* ------------------------------------------------------------------ */
/* Seed types                                                          */
/* ------------------------------------------------------------------ */

export interface SeedSpec {
  [key: string]: string;
}

export interface SeedVariant {
  label: string;
  specs: SeedSpec;
  partNumber?: string;
  sku?: string;
  gtin?: string;
  colour?: string;
}

export interface SeedProduct {
  id: string;
  brand: string;
  model: string;
  displayName: string;
  category: CategoryId;
  generation?: string;
  highlights: string[];
  imageUrl: string;
  variants: SeedVariant[];
}

export interface SeedListing {
  id: string;
  productId: string;
  variantIndex: number;
  retailer: RetailerId;
  retailerProductId: string;
  title: string;
  url: string;
  listPricePaise: number;
  mrpPaise: number;
  condition?: ListingCondition;
  /** Defaults to true when omitted. */
  inStock?: boolean;
  seller?: string;
  rating: number;
  ratingCount: number;
  reviewCount: number;
  deliveryFeePaise: number;
  /** Discount applied to the listed price to reach the "current" price, in paise. */
  observedDiscountPaise?: number;
}

export interface SeedOffer {
  listingId: string;
  kind: OfferKind;
  title: string;
  description?: string;
  percentOff?: number;
  flatOffPaise?: number;
  cashbackPaise?: number;
  couponCode?: string;
  bank?: string;
  cardType?: 'credit' | 'debit';
  membershipTier?: string;
  minSpendPaise?: number;
  maxDiscountPaise?: number;
  emiTenureMonths?: number;
  emiInterestRatePercent?: number;
  emiBank?: string;
  requiresExchange?: boolean;
  exchangeBonusPaise?: number;
  stackability?: OfferStackability;
  automatic?: boolean;
}

export interface SeedReview {
  listingId: string;
  rating: number;
  body: string;
  title?: string;
  author?: string;
  verifiedPurchase: boolean;
  daysAgo: number;
  language: ReviewLanguage;
  helpfulVotes?: number;
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export const SAMPLE_PRODUCTS: SeedProduct[] = [
  {
    id: 'prod-s24u',
    brand: 'Samsung',
    model: 'Galaxy S24 Ultra',
    displayName: 'Samsung Galaxy S24 Ultra',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1610945269064-10e6e859161e?w=600&q=80&auto=format&fit=crop',
    highlights: [
      '200MP main camera with 5x optical zoom',
      'S Pen built in',
      '6.8" QHD+ AMOLED, 120Hz',
      '5000mAh battery, 45W charging',
    ],
    variants: [
      {
        label: '12GB / 256GB / Titanium Gray',
        specs: {
          RAM: '12GB',
          'Storage Capacity': '256GB',
          Processor: 'Snapdragon 8 Gen 3',
          'Display Size': '6.8 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5000 mAh',
          'Primary Camera': '200MP + 10MP + 50MP + 5MP',
          'Number of Rear Cameras': '4',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Titanium Gray',
          Warranty: '1 year',
        },
        partNumber: 'SM-S928B',
        sku: 'SM-S928BINDTUA',
        gtin: '8806092990011',
        colour: 'titanium grey',
      },
      {
        label: '16GB / 1TB / Titanium Black',
        specs: {
          RAM: '16GB',
          'Storage Capacity': '1TB',
          Processor: 'Snapdragon 8 Gen 3',
          'Display Size': '6.8 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5000 mAh',
          'Primary Camera': '200MP + 10MP + 50MP + 5MP',
          'Number of Rear Cameras': '4',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Titanium Black',
          Warranty: '1 year',
        },
        partNumber: 'SM-S928B',
        sku: 'SM-S928BINKTUA',
        gtin: '8806092990028',
        colour: 'titanium black',
      },
    ],
  },
  {
    id: 'prod-oneplus12r',
    brand: 'OnePlus',
    model: '12R',
    displayName: 'OnePlus 12R',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&q=80&auto=format&fit=crop',
    highlights: ['Snapdragon 8 Gen 3', '5500mAh battery, 100W charging', '6.78" 120Hz AMOLED'],
    variants: [
      {
        label: '8GB / 128GB / Cool Blue',
        specs: {
          RAM: '8GB',
          'Storage Capacity': '128GB',
          Processor: 'Snapdragon 8 Gen 3',
          'Display Size': '6.78 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5500 mAh',
          'Primary Camera': '50MP + 8MP',
          'Number of Rear Cameras': '2',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Cool Blue',
          Warranty: '1 year',
        },
        partNumber: 'CPH2581',
        colour: 'blue',
      },
      {
        label: '12GB / 256GB / Iron Gray',
        specs: {
          RAM: '12GB',
          'Storage Capacity': '256GB',
          Processor: 'Snapdragon 8 Gen 3',
          'Display Size': '6.78 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5500 mAh',
          'Primary Camera': '50MP + 8MP',
          'Number of Rear Cameras': '2',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Iron Gray',
          Warranty: '1 year',
        },
        partNumber: 'CPH2581',
        colour: 'grey',
      },
    ],
  },
  {
    id: 'prod-pixel8a',
    brand: 'Google',
    model: 'Pixel 8a',
    displayName: 'Google Pixel 8a',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&q=80&auto=format&fit=crop',
    highlights: ['Tensor G3 with 7 years of OS updates', '64MP main camera', '6.1" 120Hz OLED'],
    variants: [
      {
        label: '8GB / 128GB / Obsidian',
        specs: {
          RAM: '8GB',
          'Storage Capacity': '128GB',
          Processor: 'Tensor G3',
          'Display Size': '6.1 inches',
          'Display Type': 'OLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '4492 mAh',
          'Primary Camera': '64MP + 13MP',
          'Number of Rear Cameras': '2',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Obsidian',
          Warranty: '1 year',
        },
        partNumber: 'GA04903-IN',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-a55',
    brand: 'Samsung',
    model: 'Galaxy A55 5G',
    displayName: 'Samsung Galaxy A55 5G',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1583573636246-18cb2246697f?w=600&q=80&auto=format&fit=crop',
    highlights: ['Exynos 1480', '6.6" 120Hz Super AMOLED', '5000mAh battery'],
    variants: [
      {
        label: '8GB / 128GB / Awesome Navy',
        specs: {
          RAM: '8GB',
          'Storage Capacity': '128GB',
          Processor: 'Exynos 1480',
          'Display Size': '6.6 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5000 mAh',
          'Primary Camera': '50MP + 12MP + 5MP',
          'Number of Rear Cameras': '3',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Awesome Navy',
          Warranty: '1 year',
        },
        partNumber: 'SM-A556B',
        colour: 'navy',
      },
      {
        label: '8GB / 256GB / Awesome Iceblue',
        specs: {
          RAM: '8GB',
          'Storage Capacity': '256GB',
          Processor: 'Exynos 1480',
          'Display Size': '6.6 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5000 mAh',
          'Primary Camera': '50MP + 12MP + 5MP',
          'Number of Rear Cameras': '3',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Awesome Iceblue',
          Warranty: '1 year',
        },
        partNumber: 'SM-A556B',
        colour: 'iceblue',
      },
    ],
  },
  {
    id: 'prod-v30pro',
    brand: 'vivo',
    model: 'V30 Pro',
    displayName: 'vivo V30 Pro',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1616348436168-de43ad0db179?w=600&q=80&auto=format&fit=crop',
    highlights: ['Dimensity 9300', '50MP ZEISS portrait camera', '6.78" 120Hz AMOLED'],
    variants: [
      {
        label: '12GB / 256GB / Classic Black',
        specs: {
          RAM: '12GB',
          'Storage Capacity': '256GB',
          Processor: 'MediaTek Dimensity 9300',
          'Display Size': '6.78 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5000 mAh',
          'Primary Camera': '50MP + 50MP + 50MP',
          'Number of Rear Cameras': '3',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Classic Black',
          Warranty: '1 year',
        },
        partNumber: 'V2303',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-realme12pro',
    brand: 'realme',
    model: '12 Pro+ 5G',
    displayName: 'realme 12 Pro+ 5G',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600&q=80&auto=format&fit=crop',
    highlights: ['Snapdragon 7s Gen 2', '3x periscope telephoto', '5000mAh, 67W charging'],
    variants: [
      {
        label: '8GB / 128GB / Submarine Blue',
        specs: {
          RAM: '8GB',
          'Storage Capacity': '128GB',
          Processor: 'Snapdragon 7s Gen 2',
          'Display Size': '6.7 inches',
          'Display Type': 'AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '5000 mAh',
          'Primary Camera': '50MP + 64MP + 8MP',
          'Number of Rear Cameras': '3',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Submarine Blue',
          Warranty: '1 year',
        },
        partNumber: 'RMX3901',
        colour: 'blue',
      },
    ],
  },
  {
    id: 'prod-motoedge50',
    brand: 'Motorola',
    model: 'Edge 50 Fusion',
    displayName: 'motorola edge 50 fusion',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600&q=80&auto=format&fit=crop',
    highlights: ['Snapdragon 7s Gen 2', '6.7" pOLED 144Hz', '5000mAh, 68W charging'],
    variants: [
      {
        label: '8GB / 256GB / Marshmallow Blue',
        specs: {
          RAM: '8GB',
          'Storage Capacity': '256GB',
          Processor: 'Snapdragon 7s Gen 2',
          'Display Size': '6.7 inches',
          'Display Type': 'pOLED',
          'Refresh Rate': '144Hz',
          'Battery Capacity': '5000 mAh',
          'Primary Camera': '50MP + 13MP + 8MP',
          'Number of Rear Cameras': '3',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Marshmallow Blue',
          Warranty: '1 year',
        },
        partNumber: 'XT2413',
        colour: 'blue',
      },
    ],
  },
  {
    id: 'prod-xiaomi14',
    brand: 'Xiaomi',
    model: '14',
    displayName: 'Xiaomi 14',
    category: 'smartphone',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600&q=80&auto=format&fit=crop',
    highlights: ['Snapdragon 8 Gen 3', 'Leica 50MP triple camera', '6.36" 120Hz LTPO AMOLED'],
    variants: [
      {
        label: '12GB / 512GB / Black',
        specs: {
          RAM: '12GB',
          'Storage Capacity': '512GB',
          Processor: 'Snapdragon 8 Gen 3',
          'Display Size': '6.36 inches',
          'Display Type': 'LTPO AMOLED',
          'Refresh Rate': '120Hz',
          'Battery Capacity': '4610 mAh',
          'Primary Camera': '50MP + 50MP + 50MP',
          'Number of Rear Cameras': '3',
          Network: '5G',
          'Operating System': 'Android 14',
          Colour: 'Black',
          Warranty: '1 year',
        },
        partNumber: '24031PN0DC',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-vivobook16',
    brand: 'ASUS',
    model: 'Vivobook 16',
    displayName: 'ASUS Vivobook 16 (2024)',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1517336714739-489689fd1ca8?w=600&q=80&auto=format&fit=crop',
    highlights: ['AMD Ryzen 7 7730HS', '16GB DDR5, upgradable to 32GB', '1TB NVMe SSD'],
    variants: [
      {
        label: '16GB / 1TB / Backlit Keyboard',
        specs: {
          RAM: '16GB DDR5',
          'Storage Capacity': '1TB NVMe SSD',
          Processor: 'AMD Ryzen 7 7730HS',
          'CPU Cores': '8',
          'Display Size': '16 inches',
          Resolution: '1920x1080',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '42Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '2',
          Weight: '1.88 kg',
          GPU: 'AMD Radeon 680M',
        },
        partNumber: 'X1607M-QI024WS',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-idepad3',
    brand: 'Lenovo',
    model: 'IdeaPad Slim 3',
    displayName: 'Lenovo IdeaPad Slim 3 14',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=600&q=80&auto=format&fit=crop',
    highlights: ['AMD Ryzen 5 7525HS', '8GB DDR5', '512GB SSD', '1.6kg chassis'],
    variants: [
      {
        label: '8GB / 512GB / Arctic Grey',
        specs: {
          RAM: '8GB DDR5',
          'Storage Capacity': '512GB SSD',
          Processor: 'AMD Ryzen 5 7525HS',
          'CPU Cores': '6',
          'Display Size': '14 inches',
          Resolution: '1920x1080',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '47Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '1',
          'SSD Slots': '1',
          Weight: '1.6 kg',
          GPU: 'Radeon 610M',
        },
        partNumber: '83FB0301IN',
        colour: 'grey',
      },
      {
        label: '16GB / 1TB / Arctic Grey',
        specs: {
          RAM: '16GB DDR5',
          'Storage Capacity': '1TB SSD',
          Processor: 'AMD Ryzen 5 7525HS',
          'CPU Cores': '6',
          'Display Size': '14 inches',
          Resolution: '1920x1080',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '47Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '1',
          'SSD Slots': '1',
          Weight: '1.6 kg',
          GPU: 'Radeon 610M',
        },
        partNumber: '83FB0305IN',
        colour: 'grey',
      },
    ],
  },
  {
    id: 'prod-hp14s',
    brand: 'HP',
    model: '14s',
    displayName: 'HP 14s (14-inch, 2024)',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&q=80&auto=format&fit=crop',
    highlights: ['Intel Core Ultra 5 125H', '16GB LPDDR5X', '512GB SSD', '1.39kg'],
    variants: [
      {
        label: '16GB / 512GB / Silver',
        specs: {
          RAM: '16GB LPDDR5X',
          'Storage Capacity': '512GB SSD',
          Processor: 'Intel Core Ultra 5 125H',
          'CPU Cores': '14',
          'Display Size': '14 inches',
          Resolution: '1920x1200',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '59Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '0',
          Weight: '1.39 kg',
          GPU: 'Intel Iris Xe',
        },
        partNumber: '7H3J7PA',
        colour: 'silver',
      },
    ],
  },
  {
    id: 'prod-swiftgo14',
    brand: 'Acer',
    model: 'Swift Go 14',
    displayName: 'Acer Swift Go 14 (2024)',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&q=80&auto=format&fit=crop',
    highlights: ['Intel Core Ultra 7 155H', '16GB LPDDR5X', '1TB SSD', '1.32kg'],
    variants: [
      {
        label: '16GB / 1TB / Grey',
        specs: {
          RAM: '16GB LPDDR5X',
          'Storage Capacity': '1TB SSD',
          Processor: 'Intel Core Ultra 7 155H',
          'CPU Cores': '14',
          'Display Size': '14 inches',
          Resolution: '2880x1800',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '65Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '0',
          Weight: '1.32 kg',
          GPU: 'Intel Arc Graphics',
        },
        partNumber: 'SFG14-711M',
        colour: 'grey',
      },
    ],
  },
  {
    id: 'prod-inspiron14',
    brand: 'Dell',
    model: 'Inspiron 14',
    displayName: 'Dell Inspiron 14 3520',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=600&q=80&auto=format&fit=crop',
    highlights: ['Intel Core i5-1235U', '8GB DDR4', '512GB SSD'],
    variants: [
      {
        label: '8GB / 512GB / Carbon Black',
        specs: {
          RAM: '8GB DDR4',
          'Storage Capacity': '512GB SSD',
          Processor: 'Intel Core i5-1235U',
          'CPU Cores': '12',
          'Display Size': '14 inches',
          Resolution: '1920x1080',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '41Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '2',
          Weight: '1.85 kg',
          GPU: 'Intel Iris Xe',
        },
        partNumber: '3520-1120',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-rogg16',
    brand: 'ASUS',
    model: 'ROG Strix G16',
    displayName: 'ASUS ROG Strix G16 (2024)',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&q=80&auto=format&fit=crop',
    highlights: [
      'Intel Core i7-1365HX',
      'NVIDIA RTX 4060 with 8GB VRAM',
      '16GB DDR5, 512GB SSD',
      '165Hz display',
    ],
    variants: [
      {
        label: '16GB / 512GB / Eclipse Gray',
        specs: {
          RAM: '16GB DDR5',
          'Storage Capacity': '512GB SSD',
          Processor: 'Intel Core i7-1365HX',
          'CPU Cores': '14',
          'Display Size': '16 inches',
          Resolution: '2560x1600',
          'Refresh Rate': '165Hz',
          'Battery Capacity': '90Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '2',
          'SSD Slots': '2',
          Weight: '2.5 kg',
          GPU: 'NVIDIA GeForce RTX 4060',
          VRAM: '8GB GDDR6',
        },
        partNumber: 'G16-6045W',
        colour: 'grey',
      },
    ],
  },
  {
    id: 'prod-macbookair',
    brand: 'Apple',
    model: 'MacBook Air 13',
    displayName: 'Apple MacBook Air 13 (M3)',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1517336714739-489689fd1ca8?w=600&q=80&auto=format&fit=crop',
    highlights: ['Apple M3', '8GB unified memory', '13.6" Liquid Retina', '1.24kg'],
    variants: [
      {
        label: '8GB / 256GB / Midnight',
        specs: {
          RAM: '8GB Unified Memory',
          'Storage Capacity': '256GB SSD',
          Processor: 'Apple M3',
          'CPU Cores': '8',
          'Display Size': '13.6 inches',
          Resolution: '2560x1664',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '52.6Wh',
          'Operating System': 'macOS',
          'Number of RAM Slots': '0',
          Weight: '1.24 kg',
          GPU: 'Apple M3 10-core GPU',
          VRAM: '8GB',
        },
        partNumber: 'MRXN3LL/A',
        colour: 'midnight black',
      },
      {
        label: '16GB / 512GB / Midnight',
        specs: {
          RAM: '16GB Unified Memory',
          'Storage Capacity': '512GB SSD',
          Processor: 'Apple M3',
          'CPU Cores': '8',
          'Display Size': '13.6 inches',
          Resolution: '2560x1664',
          'Refresh Rate': '60Hz',
          'Battery Capacity': '52.6Wh',
          'Operating System': 'macOS',
          'Number of RAM Slots': '0',
          Weight: '1.24 kg',
          GPU: 'Apple M3 10-core GPU',
          VRAM: '16GB',
        },
        partNumber: 'MRXW3LL/A',
        colour: 'midnight black',
      },
    ],
  },
  {
    id: 'prod-loq15',
    brand: 'Lenovo',
    model: 'LOQ 15',
    displayName: 'Lenovo LOQ 15 (2024)',
    category: 'laptop',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&q=80&auto=format&fit=crop',
    highlights: ['Intel Core i5-13500H', 'NVIDIA RTX 4050 6GB', '16GB DDR5', '1.9kg'],
    variants: [
      {
        label: '16GB / 512GB / Eclipse Black',
        specs: {
          RAM: '16GB DDR5',
          'Storage Capacity': '512GB SSD',
          Processor: 'Intel Core i5-13500H',
          'CPU Cores': '12',
          'Display Size': '15.6 inches',
          Resolution: '1920x1080',
          'Refresh Rate': '144Hz',
          'Battery Capacity': '60Wh',
          'Operating System': 'Windows 11 Home',
          'Number of RAM Slots': '2',
          'SSD Slots': '2',
          Weight: '1.9 kg',
          GPU: 'NVIDIA GeForce RTX 4050',
          VRAM: '6GB GDDR6',
        },
        partNumber: '83FE000XIN',
        colour: 'black',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Listings                                                            */
/* ------------------------------------------------------------------ */

const RETAILER_META: Record<RetailerId, { site: string; domain: string }> = {
  amazon_in: { site: 'Amazon.in', domain: 'amazon.in' },
  flipkart: { site: 'Flipkart', domain: 'flipkart.com' },
  croma: { site: 'Croma', domain: 'croma.com' },
  reliance_digital: { site: 'Reliance Digital', domain: 'reliancedigital.in' },
  vijay_sales: { site: 'Vijay Sales', domain: 'vijaysales.com' },
  myntra: { site: 'Myntra', domain: 'myntra.com' },
  ajio: { site: 'AJIO', domain: 'ajio.com' },
  tatacliq: { site: 'Tata CLiQ', domain: 'tatacliq.com' },
  decathlon: { site: 'Decathlon', domain: 'decathlon.in' },
  roadster: { site: 'Roadster', domain: 'roadster.in' },
  blinkit: { site: 'Blinkit', domain: 'blinkit.com' },
  zepto: { site: 'Zepto', domain: 'zeptonow.com' },
  sample: { site: 'SahiPick Sample Retailer', domain: 'example.test' },
};

export const SAMPLE_LISTINGS: SeedListing[] = [
  // Samsung Galaxy S24 Ultra
  {
    id: 'lst-s24u-amz-256',
    productId: 'prod-s24u',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CQNF1ZZZ',
    title: 'Samsung Galaxy S24 Ultra 5G (256 GB | Titanium Gray)',
    url: 'https://www.amazon.in/dp/B0CQNF1ZZZ',
    listPricePaise: 12999900,
    mrpPaise: 15999900,
    rating: 4.3,
    ratingCount: 12480,
    reviewCount: 12480,
    deliveryFeePaise: 0,
    observedDiscountPaise: 1000000,
  },
  {
    id: 'lst-s24u-fk-256',
    productId: 'prod-s24u',
    variantIndex: 0,
    retailer: 'flipkart',
    retailerProductId: 'COM1234',
    title: 'Samsung Galaxy S24 Ultra 5G (256 GB, Titanium Grey) - Storage 256GB',
    url: 'https://www.flipkart.com/samsung-galaxy-s24-ultra/p/itm1234',
    listPricePaise: 12499000,
    mrpPaise: 15999900,
    rating: 4.4,
    ratingCount: 9820,
    reviewCount: 9820,
    deliveryFeePaise: 0,
    observedDiscountPaise: 0,
  },
  {
    id: 'lst-s24u-croma-1tb',
    productId: 'prod-s24u',
    variantIndex: 1,
    retailer: 'croma',
    retailerProductId: 'CR-S24U-1TB',
    title: 'SAMSUNG Galaxy S24 Ultra 5G 1 TB Titanium Black',
    url: 'https://www.croma.com/product/s24u-1tb',
    listPricePaise: 14999900,
    mrpPaise: 17999900,
    rating: 4.2,
    ratingCount: 640,
    reviewCount: 640,
    deliveryFeePaise: 9900,
  },
  {
    id: 'lst-s24u-fk-1tb',
    productId: 'prod-s24u',
    variantIndex: 1,
    retailer: 'flipkart',
    retailerProductId: 'COM5678',
    title: 'Samsung Galaxy S24 Ultra 5G (1 TB, Titanium Black)',
    url: 'https://www.flipkart.com/samsung-galaxy-s24-ultra/p/itm5678',
    listPricePaise: 14499900,
    mrpPaise: 17999900,
    rating: 4.4,
    ratingCount: 3120,
    reviewCount: 3120,
    deliveryFeePaise: 0,
  },
  // OnePlus 12R
  {
    id: 'lst-op12r-amz',
    productId: 'prod-oneplus12r',
    variantIndex: 1,
    retailer: 'amazon_in',
    retailerProductId: 'B0CSQ1K5XZ',
    title: 'OnePlus 12R 5G (256GB | Iron Gray)',
    url: 'https://www.amazon.in/dp/B0CSQ1K5XZ',
    listPricePaise: 3999900,
    mrpPaise: 4999900,
    rating: 4.2,
    ratingCount: 8730,
    reviewCount: 8730,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-op12r-fk',
    productId: 'prod-oneplus12r',
    variantIndex: 0,
    retailer: 'flipkart',
    retailerProductId: 'COM9012',
    title: 'OnePlus 12R 5G Cool Blue 8GB 128GB',
    url: 'https://www.flipkart.com/oneplus-12r/p/itm9012',
    listPricePaise: 2999900,
    mrpPaise: 3999900,
    rating: 4.1,
    ratingCount: 4210,
    reviewCount: 4210,
    deliveryFeePaise: 0,
  },
  // Pixel 8a
  {
    id: 'lst-pixel8a-amz',
    productId: 'prod-pixel8a',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CSN5K1YP',
    title: 'Google Pixel 8a 5G (Obsidian, 128 GB)',
    url: 'https://www.amazon.in/dp/B0CSN5K1YP',
    listPricePaise: 4499900,
    mrpPaise: 5999900,
    rating: 4.3,
    ratingCount: 2140,
    reviewCount: 2140,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-pixel8a-croma',
    productId: 'prod-pixel8a',
    variantIndex: 0,
    retailer: 'croma',
    retailerProductId: 'CR-PIX8A',
    title: 'Google Pixel 8a 5G 128GB Obsidian',
    url: 'https://www.croma.com/product/pixel-8a',
    listPricePaise: 4649900,
    mrpPaise: 5999900,
    rating: 4.2,
    ratingCount: 380,
    reviewCount: 380,
    deliveryFeePaise: 9900,
  },
  // Galaxy A55
  {
    id: 'lst-a55-amz',
    productId: 'prod-a55',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CZ3Q1L9Z',
    title: 'Samsung Galaxy A55 5G (Awesome Navy, 8GB/128GB)',
    url: 'https://www.amazon.in/dp/B0CZ3Q1L9Z',
    listPricePaise: 3399000,
    mrpPaise: 4499000,
    rating: 4.1,
    ratingCount: 15320,
    reviewCount: 15320,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-a55-fk',
    productId: 'prod-a55',
    variantIndex: 1,
    retailer: 'flipkart',
    retailerProductId: 'COM3344',
    title: 'Samsung Galaxy A55 5G Awesome Iceblue 8GB 256GB',
    url: 'https://www.flipkart.com/samsung-galaxy-a55/p/itm3344',
    listPricePaise: 3699000,
    mrpPaise: 4699000,
    rating: 4.2,
    ratingCount: 6410,
    reviewCount: 6410,
    deliveryFeePaise: 0,
  },
  // vivo V30 Pro
  {
    id: 'lst-v30pro-amz',
    productId: 'prod-v30pro',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CZ2X7YK1',
    title: 'vivo V30 Pro 5G (Classic Black, 256GB)',
    url: 'https://www.amazon.in/dp/B0CZ2X7YK1',
    listPricePaise: 3599000,
    mrpPaise: 4299000,
    rating: 4.2,
    ratingCount: 2940,
    reviewCount: 2940,
    deliveryFeePaise: 0,
  },
  // realme 12 Pro+
  {
    id: 'lst-realme-amz',
    productId: 'prod-realme12pro',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CY1H5K9P',
    title: 'realme 12 Pro+ 5G (Submarine Blue, 128GB)',
    url: 'https://www.amazon.in/dp/B0CY1H5K9P',
    listPricePaise: 2799000,
    mrpPaise: 3299000,
    rating: 4.1,
    ratingCount: 6180,
    reviewCount: 6180,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-realme-fk',
    productId: 'prod-realme12pro',
    variantIndex: 0,
    retailer: 'flipkart',
    retailerProductId: 'COM7788',
    title: 'realme 12 Pro+ 5G 8GB 128GB Submarine Blue',
    url: 'https://www.flipkart.com/realme-12-pro-plus/p/itm7788',
    listPricePaise: 2749000,
    mrpPaise: 3299000,
    rating: 4.0,
    ratingCount: 2210,
    reviewCount: 2210,
    deliveryFeePaise: 0,
  },
  // motorola edge 50 fusion
  {
    id: 'lst-moto-amz',
    productId: 'prod-motoedge50',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CZ7T3Y4R',
    title: 'motorola edge 50 fusion 5G (256GB, Marshmallow Blue)',
    url: 'https://www.amazon.in/dp/B0CZ7T3Y4R',
    listPricePaise: 2399000,
    mrpPaise: 2699000,
    rating: 4.2,
    ratingCount: 4120,
    reviewCount: 4120,
    deliveryFeePaise: 0,
  },
  // Xiaomi 14
  {
    id: 'lst-xiaomi14-amz',
    productId: 'prod-xiaomi14',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CSK2V8LM',
    title: 'Xiaomi 14 5G (Black, 512GB, 12GB RAM)',
    url: 'https://www.amazon.in/dp/B0CSK2V8LM',
    listPricePaise: 5999000,
    mrpPaise: 6999000,
    rating: 4.3,
    ratingCount: 3210,
    reviewCount: 3210,
    deliveryFeePaise: 0,
  },
  // Vivobook 16
  {
    id: 'lst-vivo16-amz',
    productId: 'prod-vivobook16',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CYP6P3QT',
    title: 'ASUS Vivobook 16 (2024) Ryzen 7 7730HS 16GB 1TB Windows 11 Home',
    url: 'https://www.amazon.in/dp/B0CYP6P3QT',
    listPricePaise: 6299000,
    mrpPaise: 7499000,
    rating: 4.2,
    ratingCount: 3410,
    reviewCount: 3410,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-vivo16-reliance',
    productId: 'prod-vivobook16',
    variantIndex: 0,
    retailer: 'reliance_digital',
    retailerProductId: 'RD-VB16-16',
    title: 'ASUS Vivobook 16 2024 AMD Ryzen 7 7730HS 16GB 1TB SSD',
    url: 'https://www.reliancedigital.in/product/asus-vivobook-16',
    listPricePaise: 6499000,
    mrpPaise: 7499000,
    rating: 4.1,
    ratingCount: 210,
    reviewCount: 210,
    deliveryFeePaise: 0,
  },
  // IdeaPad Slim 3
  {
    id: 'lst-idepad-amz',
    productId: 'prod-idepad3',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CQ9M1J2K',
    title: 'Lenovo IdeaPad Slim 3 14 Ryzen 5 7525HS 8GB 512GB',
    url: 'https://www.amazon.in/dp/B0CQ9M1J2K',
    listPricePaise: 4599000,
    mrpPaise: 5499000,
    rating: 4.1,
    ratingCount: 7840,
    reviewCount: 7840,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-idepad-fk',
    productId: 'prod-idepad3',
    variantIndex: 1,
    retailer: 'flipkart',
    retailerProductId: 'COM4455',
    title: 'Lenovo IdeaPad Slim 3 14 Ryzen 5 7525HS 16GB 1TB',
    url: 'https://www.flipkart.com/lenovo-idepad-slim-3/p/itm4455',
    listPricePaise: 5499000,
    mrpPaise: 6299000,
    rating: 4.2,
    ratingCount: 2210,
    reviewCount: 2210,
    deliveryFeePaise: 0,
  },
  // HP 14s
  {
    id: 'lst-hp14s-amz',
    productId: 'prod-hp14s',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CY8V6KLP',
    title: 'HP 14s Intel Core Ultra 5 125H 16GB 512GB 14 inch',
    url: 'https://www.amazon.in/dp/B0CY8V6KLP',
    listPricePaise: 6599000,
    mrpPaise: 7499000,
    rating: 4.1,
    ratingCount: 1530,
    reviewCount: 1530,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-hp14s-vijay',
    productId: 'prod-hp14s',
    variantIndex: 0,
    retailer: 'vijay_sales',
    retailerProductId: 'VS-HP14S-16',
    title: 'HP 14s 14 Intel Core Ultra 5 125H 16GB 512GB Silver',
    url: 'https://www.vijaysales.com/product/hp-14s',
    listPricePaise: 6699000,
    mrpPaise: 7499000,
    rating: 4.0,
    ratingCount: 120,
    reviewCount: 120,
    deliveryFeePaise: 0,
  },
  // Acer Swift Go 14
  {
    id: 'lst-swiftgo-amz',
    productId: 'prod-swiftgo14',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CZ2H9LK3',
    title: 'Acer Swift Go 14 Intel Core Ultra 7 155H 16GB 1TB',
    url: 'https://www.amazon.in/dp/B0CZ2H9LK3',
    listPricePaise: 8499000,
    mrpPaise: 9999000,
    rating: 4.3,
    ratingCount: 980,
    reviewCount: 980,
    deliveryFeePaise: 0,
  },
  // Dell Inspiron 14
  {
    id: 'lst-inspiron-amz',
    productId: 'prod-inspiron14',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0BZ4Q1ST9',
    title: 'Dell Inspiron 14 3520 Intel Core i5 12th Gen 8GB 512GB',
    url: 'https://www.amazon.in/dp/B0BZ4Q1ST9',
    listPricePaise: 4799000,
    mrpPaise: 5999000,
    rating: 3.9,
    ratingCount: 4210,
    reviewCount: 4210,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-inspiron-reliance',
    productId: 'prod-inspiron14',
    variantIndex: 0,
    retailer: 'reliance_digital',
    retailerProductId: 'RD-INSP-3520',
    title: 'Dell Inspiron 14 3520 Core i5 1235U 8GB 512GB',
    url: 'https://www.reliancedigital.in/product/dell-inspiron-14',
    listPricePaise: 4899000,
    mrpPaise: 5999000,
    rating: 3.8,
    ratingCount: 180,
    reviewCount: 180,
    deliveryFeePaise: 0,
  },
  // ROG Strix G16
  {
    id: 'lst-rogg16-amz',
    productId: 'prod-rogg16',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CZD4K9NM',
    title: 'ASUS ROG Strix G16 RTX 4060 Core i7 16GB 512GB 16 inch 165Hz',
    url: 'https://www.amazon.in/dp/B0CZD4K9NM',
    listPricePaise: 11999900,
    mrpPaise: 13999900,
    rating: 4.4,
    ratingCount: 2340,
    reviewCount: 2340,
    deliveryFeePaise: 0,
  },
  // MacBook Air M3
  {
    id: 'lst-mba-amz',
    productId: 'prod-macbookair',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CT3MQRT7',
    title: 'Apple MacBook Air 13 M3 8GB 256GB Midnight',
    url: 'https://www.amazon.in/dp/B0CT3MQRT7',
    listPricePaise: 10490000,
    mrpPaise: 11490000,
    rating: 4.4,
    ratingCount: 3120,
    reviewCount: 3120,
    deliveryFeePaise: 0,
  },
  {
    id: 'lst-mba-16-fk',
    productId: 'prod-macbookair',
    variantIndex: 1,
    retailer: 'flipkart',
    retailerProductId: 'COM5566',
    title: 'Apple MacBook Air 13 M3 16GB 512GB Midnight',
    url: 'https://www.flipkart.com/apple-macbook-air-m3/p/itm5566',
    listPricePaise: 14490000,
    mrpPaise: 14990000,
    rating: 4.5,
    ratingCount: 980,
    reviewCount: 980,
    deliveryFeePaise: 0,
  },
  // LOQ 15
  {
    id: 'lst-loq-amz',
    productId: 'prod-loq15',
    variantIndex: 0,
    retailer: 'amazon_in',
    retailerProductId: 'B0CZD9K2LP',
    title: 'Lenovo LOQ 15 Core i5 13500H RTX 4050 16GB 512GB 144Hz',
    url: 'https://www.amazon.in/dp/B0CZD9K2LP',
    listPricePaise: 7999000,
    mrpPaise: 8999000,
    rating: 4.2,
    ratingCount: 3210,
    reviewCount: 3210,
    deliveryFeePaise: 0,
  },
];

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Offers are attached per retailer because bank and membership offers are
 * retailer-specific in India.
 */
export const SAMPLE_OFFERS: SeedOffer[] = [
  {
    listingId: 'lst-s24u-amz-256',
    kind: 'bank_discount',
    title: '10% instant discount on HDFC Bank Credit Card',
    description: 'Max discount ₹2,500 on orders above ₹10,000.',
    percentOff: 10,
    maxDiscountPaise: 250000,
    bank: 'HDFC Bank',
    cardType: 'credit',
    minSpendPaise: 1000000,
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-s24u-amz-256',
    kind: 'coupon',
    title: '₹1,000 off on Samsung devices',
    description: 'Apply coupon code SP1000 on checkout.',
    flatOffPaise: 100000,
    couponCode: 'SP1000',
    automatic: false,
  },
  {
    listingId: 'lst-s24u-fk-256',
    kind: 'bank_discount',
    title: '5% cashback on Axis Bank Credit Card',
    description: 'Cashback credited to the card within 60 days.',
    cashbackPaise: 600000,
    bank: 'Axis Bank',
    cardType: 'credit',
    minSpendPaise: 1000000,
  },
  {
    listingId: 'lst-s24u-fk-256',
    kind: 'coupon',
    title: '₹2,000 off for Flipkart Plus members',
    flatOffPaise: 200000,
    membershipTier: 'Flipkart Plus',
    stackability: 'exclusive',
  },
  {
    listingId: 'lst-s24u-croma-1tb',
    kind: 'exchange',
    title: '₹12,000 exchange bonus for old Galaxy device',
    exchangeBonusPaise: 1200000,
    requiresExchange: true,
  },
  {
    listingId: 'lst-s24u-croma-1tb',
    kind: 'emi',
    title: 'No-cost EMI on ICICI Bank credit cards',
    emiTenureMonths: 6,
    emiInterestRatePercent: 13,
    emiBank: 'ICICI Bank',
  },
  {
    listingId: 'lst-op12r-amz',
    kind: 'bank_discount',
    title: '10% instant discount on ICICI Bank Credit Card',
    percentOff: 10,
    maxDiscountPaise: 150000,
    bank: 'ICICI Bank',
    cardType: 'credit',
    minSpendPaise: 400000,
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-op12r-amz',
    kind: 'cashback',
    title: '₹300 cashback via Amazon Pay Balance',
    cashbackPaise: 30000,
  },
  {
    listingId: 'lst-pixel8a-amz',
    kind: 'card_offer',
    title: '₹1,000 off on Google Pay with select cards',
    flatOffPaise: 100000,
    cardType: 'credit',
  },
  {
    listingId: 'lst-a55-amz',
    kind: 'bank_discount',
    title: '10% instant discount on SBI Card',
    percentOff: 10,
    maxDiscountPaise: 100000,
    bank: 'SBI Card',
    cardType: 'credit',
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-a55-fk',
    kind: 'coupon',
    title: '₹1,500 off on select Samsung phones',
    flatOffPaise: 150000,
    couponCode: 'SAMSUNG15',
  },
  {
    listingId: 'lst-v30pro-amz',
    kind: 'bank_discount',
    title: '₹2,000 off on HDFC Bank Credit Card',
    flatOffPaise: 200000,
    bank: 'HDFC Bank',
    cardType: 'credit',
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-realme-amz',
    kind: 'coupon',
    title: '₹1,000 off on realme phones',
    flatOffPaise: 100000,
    couponCode: 'REALME1K',
  },
  {
    listingId: 'lst-moto-amz',
    kind: 'delivery',
    title: 'Free delivery on orders above ₹499',
    maxDiscountPaise: 9900,
  },
  {
    listingId: 'lst-vivo16-amz',
    kind: 'bank_discount',
    title: '10% instant discount on HDFC Bank Credit Card',
    percentOff: 10,
    maxDiscountPaise: 100000,
    bank: 'HDFC Bank',
    cardType: 'credit',
    minSpendPaise: 500000,
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-vivo16-amz',
    kind: 'emi',
    title: 'EMI from ₹2,499/month on HDFC Bank cards',
    emiTenureMonths: 6,
    emiInterestRatePercent: 13,
    emiBank: 'HDFC Bank',
  },
  {
    listingId: 'lst-idepad-amz',
    kind: 'bank_discount',
    title: '5% discount on Amazon Pay ICICI Credit Card',
    percentOff: 5,
    maxDiscountPaise: 150000,
    bank: 'ICICI Bank',
    cardType: 'credit',
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-hp14s-amz',
    kind: 'coupon',
    title: '₹2,000 off on HP laptops',
    flatOffPaise: 200000,
    couponCode: 'HPLAP2K',
  },
  {
    listingId: 'lst-hp14s-vijay',
    kind: 'emi',
    title: 'No-cost EMI available',
    emiTenureMonths: 6,
    emiInterestRatePercent: 11,
  },
  {
    listingId: 'lst-swiftgo-amz',
    kind: 'bank_discount',
    title: '₹2,500 off on IDFC FIRST Credit Card',
    flatOffPaise: 250000,
    bank: 'IDFC FIRST',
    cardType: 'credit',
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-inspiron-amz',
    kind: 'coupon',
    title: '₹1,000 off on Dell laptops',
    flatOffPaise: 100000,
    couponCode: 'DELL1K',
  },
  {
    listingId: 'lst-rogg16-amz',
    kind: 'bank_discount',
    title: '₹3,000 off on RBL Credit Card',
    flatOffPaise: 300000,
    bank: 'RBL',
    cardType: 'credit',
    stackability: 'primary_only',
  },
  {
    listingId: 'lst-mba-amz',
    kind: 'cashback',
    title: '₹5,000 cashback on SBI Card',
    cashbackPaise: 500000,
    bank: 'SBI Card',
    cardType: 'credit',
  },
  {
    listingId: 'lst-loq-amz',
    kind: 'bank_discount',
    title: '10% discount on Axis Bank Credit Card',
    percentOff: 10,
    maxDiscountPaise: 200000,
    bank: 'Axis Bank',
    cardType: 'credit',
    minSpendPaise: 750000,
    stackability: 'primary_only',
  },
];

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

/**
 * Review bodies are drawn from a pool of realistic Indian marketplace reviews
 * in English, Hindi and Hinglish. They are sample data and are labelled as
 * such wherever they surface.
 */
const REVIEW_POOL_POSITIVE: { body: string; title?: string; rating: number }[] = [
  {
    title: 'Excellent camera phone',
    body: 'The camera is excellent, the pictures are sharp even at night. Battery life is great, lasts a full day with heavy use. Very smooth performance, no lag at all.',
    rating: 5,
  },
  {
    title: 'Battery is the best part',
    body: 'Long battery life is the standout feature. I charge it once every two days. Display is gorgeous with smooth 120Hz. Build quality feels premium too.',
    rating: 5,
  },
  {
    title: 'Worth every rupee',
    body: 'Value for money is unbeatable at this price. Performance is fast and smooth, multitasking is great. Delivered on time and the packaging was solid.',
    rating: 5,
  },
  {
    title: 'Clean software experience',
    body: 'Software is clean, no bloatware, and regular updates come through. Smooth UI, no lag while switching apps. Still working fine after 8 months.',
    rating: 5,
  },
  {
    title: 'Camera performance is great',
    body: 'Great camera and the zoom is genuinely useful. The build quality is excellent and it feels premium. Battery backup is good for a heavy day.',
    rating: 5,
  },
  {
    title: 'Solid all round',
    body: 'Excellent camera, good display, and performance is very smooth. Heating is not an issue even while gaming. Battery life is good.',
    rating: 5,
  },
  {
    title: 'Camera is the reason I bought it',
    body: 'Camera is excellent for the price, photos are sharp and the low light performance is good too. Battery life is good, build quality is solid.',
    rating: 4,
  },
  {
    title: 'Battery mast hai',
    body: 'Battery backup is bahut achha, poori din chalta hai. Camera bhi mast hai, photos mast aati hain. Paisa vasool product hai.',
    rating: 5,
  },
];

const REVIEW_POOL_NEGATIVE: { body: string; title?: string; rating: number }[] = [
  {
    title: 'Battery drains fast',
    body: 'Battery drain is the main problem. Good battery life initially but after 6 months the battery health degraded badly. Otherwise the camera is fine.',
    rating: 3,
  },
  {
    title: 'Heating issues while charging',
    body: 'Serious heating issue when charging, the phone becomes very hot. Also the software has lots of bugs and updates are slow. Performance is okay otherwise.',
    rating: 2,
  },
  {
    title: 'Not worth the price',
    body: 'Overpriced for what you get. Build quality feels cheap, the plastic back scratches in a week. Battery life is poor and it heats up during calls.',
    rating: 2,
  },
  {
    title: 'Service experience was bad',
    body: 'Warranty claim was a complete waste of time, customer service had no response for 10 days. Eventually the refund was not received. Product itself is fine.',
    rating: 2,
  },
  {
    title: 'Slow and buggy',
    body: 'Software updates introduced lag, the phone keeps freezing and restarting itself. After one year it stopped working properly. Not worth buying.',
    rating: 2,
  },
  {
    title: 'Heating bahut zyada',
    body: 'Gaming ke time bahut garam ho jata hai, heating issue bahut zyada hai. Battery bhi jaldi khatam ho jati hai. Camera accha hai but overall experience is average.',
    rating: 3,
  },
  {
    title: 'Defective unit',
    body: 'Display had a dead pixel from day one and the battery drain was terrible. Refund was processed after a lot of effort. Customer service is the worst.',
    rating: 1,
  },
  {
    title: 'Battery degradation over time',
    body: 'Battery backup was good in the first months but the battery health degraded a lot. Charging is slow now. Build quality is good though and the camera is nice.',
    rating: 3,
  },
];

const REVIEW_POOL_MIXED: { body: string; title?: string; rating: number }[] = [
  {
    title: 'Good but not perfect',
    body: 'Display is excellent and performance is smooth for most work. But heating shows up under load and the camera is average in low light. Battery life is fine.',
    rating: 4,
  },
  {
    title: 'Good value overall',
    body: 'Performance is good for the price and the display is sharp. Battery life is average, not the best. Build quality is decent, camera is fine in daylight.',
    rating: 4,
  },
  {
    title: 'Mixed feelings',
    body: 'The screen is very good and multitasking is smooth. However the speakers are average and there is some heating after long sessions. Overall value for money is fine.',
    rating: 3,
  },
  {
    title: 'Solid but heavy',
    body: 'Build quality is excellent, no complaints there. Performance is very smooth. But it is too heavy to carry daily and battery life is only average.',
    rating: 4,
  },
];

const AUTHOR_NAMES = [
  'Rohit S.',
  'Priya M.',
  'Ankit Verma',
  'Sneha K.',
  'Vikram Reddy',
  'Rahul D.',
  'Meera Iyer',
  'Arjun Nair',
  'Kavya S.',
  'Suresh Kumar',
  'Nikhil J.',
  'Pooja B.',
];

/**
 * Laptop-specific review bodies.
 *
 * A phone review pool applied to a laptop produces nonsense claims ("camera is
 * average" on a laptop), which would make the review intelligence look broken
 * even though the engine is working. Reviews are therefore drawn from a pool
 * that matches the product category.
 */
const LAPTOP_REVIEW_POOL_POSITIVE: { body: string; title?: string; rating: number }[] = [
  {
    title: 'Smooth performance',
    body: 'Performance is very smooth, no lag while compiling. Display is sharp and the build quality feels premium. Battery life is good for a working day.',
    rating: 5,
  },
  {
    title: 'Great for development',
    body: 'Ran Docker and a full IDE without any slowdown. Display is excellent, keyboard is good, and build quality is solid. Battery backup is decent.',
    rating: 5,
  },
  {
    title: 'Value for money',
    body: 'Excellent value for money at this price. Performance is fast, screen is sharp, and the fan stays quiet under normal load. Storage is plenty.',
    rating: 5,
  },
  {
    title: 'Battery life is great',
    body: 'Long battery life for a laptop of this class, around 7 hours of real work. Performance is smooth and the display is bright. No heating issues.',
    rating: 5,
  },
  {
    title: 'Solid build, great screen',
    body: 'Build quality is excellent and the screen is gorgeous. Performance is very smooth, storage is fast and the software runs without complaints.',
    rating: 5,
  },
  {
    title: 'Linux friendly',
    body: 'Works perfectly with Linux, all drivers were detected. Performance is smooth, the keyboard is excellent and the display is sharp. Good value for money.',
    rating: 5,
  },
  {
    title: 'Smooth and quiet',
    body: 'The fan is quiet and performance stays smooth even with many tabs. Display is good, battery life is good, build quality is solid.',
    rating: 4,
  },
];

const LAPTOP_REVIEW_POOL_NEGATIVE: { body: string; title?: string; rating: number }[] = [
  {
    title: 'Heating and throttling under load',
    body: 'Serious heating issue when compiling for a few minutes, it throttles and slows down. Build quality is good and the display is nice but performance suffers under load.',
    rating: 3,
  },
  {
    title: 'Fan noise is terrible',
    body: 'Fan noise is very loud and the heating is noticeable. Battery drain is poor too. Display is fine but overall performance is disappointing for the price.',
    rating: 2,
  },
  {
    title: 'Battery drains quickly',
    body: 'Battery life is bad, lasts only 3 hours. Performance is otherwise smooth and the build quality is good. Charging is slow as well.',
    rating: 3,
  },
  {
    title: 'Cheap build, cracked hinge',
    body: 'The hinge cracked in three months, build quality is cheap and the keyboard flexes. Not worth buying at this price. Display is average too.',
    rating: 2,
  },
  {
    title: 'Network problems',
    body: 'WiFi drops constantly, network issue on every call. Battery drain is terrible. After one year the battery stopped working properly. Not worth it.',
    rating: 2,
  },
  {
    title: 'Dead in 6 months',
    body: 'It stopped working after 6 months, the motherboard went dead. Warranty claim was a waste of time, customer service had no response. Waste of money.',
    rating: 1,
  },
  {
    title: 'Screen is dim, RAM not upgradeable',
    body: 'Screen is dim in daylight and the RAM is not upgradeable, which is a real problem for development. Performance is fine and the keyboard is good.',
    rating: 3,
  },
  {
    title: 'Heating bahut zyada',
    body: 'Gaming aur compilation dono mein bahut garam ho jata hai, heating issue bahut zyada hai. Battery bhi jaldi khatam ho jaati hai. Display accha hai.',
    rating: 3,
  },
];

const LAPTOP_REVIEW_POOL_MIXED: { body: string; title?: string; rating: number }[] = [
  {
    title: 'Good but fans get loud',
    body: 'Performance is smooth for everyday work and the display is sharp. However the fan gets loud under load and battery life is only average. Value for money is fine.',
    rating: 4,
  },
  {
    title: 'Great screen, average battery',
    body: 'Display is excellent and build quality is premium. Performance is good but the battery drains faster than expected and there is some heating in summer.',
    rating: 4,
  },
  {
    title: 'Solid machine',
    body: 'Build quality is solid, the keyboard is excellent and performance is smooth. Storage is enough but RAM cannot be expanded, and battery life is average.',
    rating: 4,
  },
];

/**
 * Neutral closing clauses appended to clean reviews.
 *
 * Without them, a small template pool produces near-identical bodies, and the
 * duplicate detector correctly flags every product as having suspicious
 * review patterns — which is a property of the sample pool, not of the
 * product. Varying the closing clause keeps each review distinct while
 * preserving the aspect signals.
 */
const REVIEW_VARIATION_SUFFIXES = [
  ' Delivery was quick and the packaging was intact.',
  ' I bought it during the sale and the price was fair.',
  ' This replaced a four-year-old one.',
  ' Bought this for my parents.',
  ' This is my second purchase from this brand.',
  ' Worth the upgrade from my previous device.',
  ' Got it at a good price compared to other stores.',
  ' Still going strong after two months.',
  ' I will update this review after a few more months.',
  ' The seller was helpful when I asked a question.',
  ' I compared three models before settling on this one.',
  ' Ordered on a weekday and it arrived the next day.',
  ' My daily driver, and it has not let me down.',
  ' Nothing to complain about at this price point.',
  ' It handles my workload without any fuss.',
  ' The manual was not very helpful, but the product itself is.',
];

/** Listing id → product category, so reviews can match the product type. */
function buildListingCategoryMap(): Map<string, CategoryId> {
  const productCategory = new Map<string, CategoryId>();
  for (const product of SAMPLE_PRODUCTS) productCategory.set(product.id, product.category);

  const map = new Map<string, CategoryId>();
  for (const listing of SAMPLE_LISTINGS) {
    const category = productCategory.get(listing.productId);
    if (category) map.set(listing.id, category);
  }
  return map;
}

/**
 * Which listings get how many reviews. A couple of listings deliberately get
 * an unusual pattern so the authenticity signals have something to detect.
 */
const REVIEW_PLAN: { listingId: string; count: number; profile: 'clean' | 'burst' | 'duplicated' }[] = [
  { listingId: 'lst-s24u-amz-256', count: 42, profile: 'clean' },
  { listingId: 'lst-s24u-fk-256', count: 34, profile: 'clean' },
  { listingId: 'lst-s24u-fk-1tb', count: 18, profile: 'clean' },
  { listingId: 'lst-op12r-amz', count: 30, profile: 'clean' },
  { listingId: 'lst-op12r-fk', count: 22, profile: 'clean' },
  { listingId: 'lst-pixel8a-amz', count: 26, profile: 'clean' },
  { listingId: 'lst-a55-amz', count: 38, profile: 'clean' },
  { listingId: 'lst-a55-fk', count: 24, profile: 'clean' },
  { listingId: 'lst-v30pro-amz', count: 20, profile: 'clean' },
  { listingId: 'lst-realme-amz', count: 28, profile: 'clean' },
  { listingId: 'lst-moto-amz', count: 19, profile: 'clean' },
  { listingId: 'lst-xiaomi14-amz', count: 16, profile: 'clean' },
  { listingId: 'lst-vivo16-amz', count: 31, profile: 'clean' },
  { listingId: 'lst-idepad-amz', count: 36, profile: 'clean' },
  { listingId: 'lst-idepad-fk', count: 21, profile: 'clean' },
  { listingId: 'lst-hp14s-amz', count: 25, profile: 'clean' },
  { listingId: 'lst-swiftgo-amz', count: 17, profile: 'clean' },
  { listingId: 'lst-inspiron-amz', count: 29, profile: 'clean' },
  { listingId: 'lst-inspiron-reliance', count: 12, profile: 'clean' },
  { listingId: 'lst-rogg16-amz', count: 33, profile: 'clean' },
  { listingId: 'lst-mba-amz', count: 27, profile: 'clean' },
  { listingId: 'lst-mba-16-fk', count: 14, profile: 'clean' },
  { listingId: 'lst-loq-amz', count: 23, profile: 'clean' },
  // Deliberately anomalous patterns, so the detection logic is exercised.
  { listingId: 'lst-v30pro-amz', count: 14, profile: 'duplicated' },
  { listingId: 'lst-xiaomi14-amz', count: 12, profile: 'burst' },
];

function detectLanguageFor(body: string): ReviewLanguage {
  const devanagari = (body.match(/[\u0900-\u097F]/g) ?? []).length;
  if (devanagari / Math.max(1, body.length) > 0.12) return 'hi';
  const hinglishMarkers = ['hai', 'nahi', 'bahut', 'accha', 'acha', 'mast', 'paisa', 'garam', 'khatam'];
  const words = body.toLowerCase().split(/\s+/);
  const hits = words.filter((word) => hinglishMarkers.includes(word)).length;
  if (hits / Math.max(1, words.length) > 0.05) return 'hinglish';
  return 'en';
}

/** Build the sample review corpus deterministically. */
export function buildSampleReviews(): SeedReview[] {
  const reviews: SeedReview[] = [];
  const listingCategory = buildListingCategoryMap();
  let counter = 0;

  for (const plan of REVIEW_PLAN) {
    const category = listingCategory.get(plan.listingId) ?? 'smartphone';
    const isLaptop = category === 'laptop';
    const positivePool = isLaptop ? LAPTOP_REVIEW_POOL_POSITIVE : REVIEW_POOL_POSITIVE;
    const negativePool = isLaptop ? LAPTOP_REVIEW_POOL_NEGATIVE : REVIEW_POOL_NEGATIVE;
    const mixedPool = isLaptop ? LAPTOP_REVIEW_POOL_MIXED : REVIEW_POOL_MIXED;

    for (let i = 0; i < plan.count; i += 1) {
      counter += 1;
      let template: { body: string; title?: string; rating: number };

      if (plan.profile === 'duplicated') {
        // Near-identical wording repeated across many reviews.
        template = isLaptop
          ? {
              title: 'Great laptop',
              body: 'Excellent performance, great battery life and a very smooth display. Value for money is superb. Highly recommended, best in this budget.',
              rating: 5,
            }
          : {
              title: 'Great product',
              body: 'Excellent camera, great battery life and very smooth performance. Value for money is superb. Highly recommended, best in this budget.',
              rating: 5,
            };
      } else if (plan.profile === 'burst') {
        // A tight cluster of five-star reviews on the same day.
        template = pick(positivePool);
      } else {
        const roll = random();
        if (roll < 0.46) template = pick(positivePool);
        else if (roll < 0.72) template = pick(negativePool);
        else template = pick(mixedPool);

        // Vary the closing clause so that reviews drawn from the same template
        // are still distinct texts.
        template = {
          ...template,
          body: `${template.body} ${pick(REVIEW_VARIATION_SUFFIXES)}`,
        };
      }

      const daysAgo =
        plan.profile === 'burst'
          ? pickInt(2, 4)
          : Math.min(700, Math.max(1, Math.round(700 * (1 - i / plan.count)) + pickInt(0, 20)));

      reviews.push({
        listingId: plan.listingId,
        rating: template.rating,
        body: template.body,
        title: template.title,
        author: pick(AUTHOR_NAMES),
        verifiedPurchase: plan.profile === 'duplicated' ? random() > 0.55 : random() > 0.12,
        daysAgo,
        language: detectLanguageFor(template.body),
        helpfulVotes: pickInt(0, 45),
      });
    }
  }

  return reviews;
}

/* ------------------------------------------------------------------ */
/* Price history                                                       */
/* ------------------------------------------------------------------ */

/**
 * Generate a plausible price history for a listing.
 *
 * This is SAMPLE data. It is clearly marked as such and the buy/wait engine
 * lowers its confidence accordingly, because simulated history must never be
 * used to time a real purchase.
 */
export function buildSamplePriceHistory(
  listingId: string,
  listPricePaise: number,
  observedDiscountPaise = 0,
  days = 120,
): { pricePaise: number; daysAgo: number }[] {
  const series: { pricePaise: number; daysAgo: number }[] = [];
  const base = listPricePaise - observedDiscountPaise;
  const volatility = 0.04 + random() * 0.03;

  for (let day = days; day >= 0; day -= 1) {
    // A gentle downward trend with noise, plus a festive dip.
    const trend = 1 + (day / days) * 0.12;
    const noise = 1 + (random() - 0.5) * volatility;
    let price = Math.round((base * trend * noise) / 100) * 100;

    // Diwali-period dip around day 40.
    if (day >= 36 && day <= 44) price = Math.round((price * 0.88) / 100) * 100;

    series.push({ pricePaise: Math.max(100, price), daysAgo: day });
  }
  return series;
}

export { RETAILER_META };
