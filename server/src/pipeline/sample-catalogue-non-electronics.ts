/**
 * Non-electronics sample products.
 *
 * These exist to prove the category framework is universal rather than
 * phone-and-laptop specific: an appliance is separated by capacity and energy
 * rating, a shoe by size, earbuds by form factor and ANC, and a grocery item by
 * pack size — and the same engine scores them without modification.
 */

import type { SeedProduct } from './sample-catalogue.ts';

export const SAMPLE_NON_ELECTRONICS: SeedProduct[] = [
  {
    id: 'prod-cotton-tshirt',
    brand: 'Roadster',
    model: 'Cotton Crew T-Shirt',
    displayName: 'Roadster Men Cotton Crew T-Shirt',
    category: 'fashion',
    generation: '2025',
    imageUrl:
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80&auto=format&fit=crop',
    highlights: ['100% combed cotton', 'Regular fit', 'Machine washable'],
    variants: [
      {
        label: 'M / Black',
        specs: {
          Size: 'M',
          Colour: 'Black',
          Material: 'Combed Cotton',
          Gender: 'Men',
          Fit: 'Regular',
        },
        partNumber: 'RDT-M-BLK',
        colour: 'black',
      },
      {
        label: 'L / Navy',
        specs: {
          Size: 'L',
          Colour: 'Navy',
          Material: 'Combed Cotton',
          Gender: 'Men',
          Fit: 'Regular',
        },
        partNumber: 'RDT-L-NVY',
        colour: 'navy',
      },
    ],
  },
  {
    id: 'prod-chinos',
    brand: 'Lee',
    model: 'Cotton Chinos',
    displayName: "Lee Men's Slim Fit Cotton Chinos",
    category: 'fashion',
    generation: '2025',
    imageUrl:
      'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=600&q=80&auto=format&fit=crop',
    highlights: ['Cotton twill', 'Slim fit', 'Belt loops'],
    variants: [
      {
        label: '32 / Khaki',
        specs: {
          Size: '32',
          Colour: 'Khaki',
          Material: 'Cotton Twill',
          Gender: 'Men',
          Fit: 'Slim',
        },
        partNumber: 'LEE-32-KHK',
        colour: 'khaki',
      },
    ],
  },
  {
    id: 'prod-washer8',
    brand: 'LG',
    model: 'Front Load 8kg',
    displayName: 'LG 8kg Front Load Washing Machine (FP4R8)',
    category: 'appliance',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=600&q=80&auto=format&fit=crop',
    highlights: [
      '8kg wash capacity',
      '5-star energy rating',
      'Inverter direct drive motor',
      '10-year motor warranty',
    ],
    variants: [
      {
        label: '8kg / 5 Star Inverter / White',
        specs: {
          Capacity: '8 kg',
          'Energy Rating': '5 Star',
          Inverter: 'Yes',
          'Power Consumption': '450 W',
          'Max Spin Speed': '1400 RPM',
          Warranty: '2 years on product, 10 years on motor',
        },
        partNumber: 'FP4R8W',
        colour: 'white',
      },
    ],
  },
  {
    id: 'prod-siemens-washer',
    brand: 'Siemens',
    model: 'Washing Machine 7kg',
    displayName: 'Siemens 7kg Fully Automatic Washing Machine',
    category: 'appliance',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=600&q=80&auto=format&fit=crop',
    highlights: ['7kg capacity', 'iQdrive motor', '15 wash programs', '5-star energy rating'],
    variants: [
      {
        label: '7kg / 5 Star Inverter / Silver',
        specs: {
          Capacity: '7 kg',
          'Energy Rating': '5 Star',
          Inverter: 'Yes',
          'Power Consumption': '400 W',
          'Max Spin Speed': '1400 RPM',
          Warranty: '2 years on product, 10 years on motor',
        },
        partNumber: 'WM75A5',
        colour: 'silver',
      },
    ],
  },
  {
    id: 'prod-buds141',
    brand: 'boAt',
    model: 'Airdopes 141',
    displayName: 'boAt Airdopes 141',
    category: 'audio',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&q=80&auto=format&fit=crop',
    highlights: ['42 hours total playback', 'Low latency mode for gaming', 'Bluetooth 5.3'],
    variants: [
      {
        label: 'Black / In-ear / Bluetooth 5.3',
        specs: {
          'Form Factor': 'in-ear',
          'Battery Life': '42 hours',
          ANC: 'No',
          'Driver Size': '13 mm',
          Interface: 'bluetooth',
          Warranty: '1 year',
        },
        partNumber: 'RBL-141',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-realmebuds',
    brand: 'realme',
    model: 'Buds T310',
    displayName: 'realme Buds T310',
    category: 'audio',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=600&q=80&auto=format&fit=crop',
    highlights: ['40 hours playback', '40dB hybrid ANC', 'Spatial audio', 'IPX5 rated'],
    variants: [
      {
        label: 'White / In-ear / Hybrid ANC',
        specs: {
          'Form Factor': 'in-ear',
          'Battery Life': '40 hours',
          ANC: 'Yes',
          'Driver Size': '12 mm',
          Interface: 'bluetooth',
          Warranty: '1 year',
        },
        partNumber: 'RMA-T310',
        colour: 'white',
      },
    ],
  },
  {
    id: 'prod-pegasus40',
    brand: 'Nike',
    model: 'Pegasus 40',
    displayName: 'Nike Air Zoom Pegasus 40',
    category: 'shoes',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80&auto=format&fit=crop',
    highlights: [
      'Zoom Air cushioning',
      'React foam midsole',
      'Woven mesh upper',
      'Rubber waffle outsole',
      '248g per shoe (UK 9)',
    ],
    variants: [
      {
        label: 'UK 8 / Black / Engineered mesh',
        specs: {
          Size: 'UK 8',
          'Size Standard': 'UK/US',
          Width: 'Standard',
          'Upper Material': 'Woven Mesh',
          'Midsole Material': 'React Foam',
          'Outsole Material': 'Rubber',
          'Sole Thickness': '10 mm',
          Weight: '244 g',
          Gender: 'Men',
          Colour: 'Black',
          Surface: 'Road',
          Warranty: '6 months manufacturing',
        },
        partNumber: 'DM8963-001',
        colour: 'black',
      },
      {
        label: 'UK 9 / Black / Engineered mesh',
        specs: {
          Size: 'UK 9',
          'Size Standard': 'UK/US',
          Width: 'Standard',
          'Upper Material': 'Woven Mesh',
          'Midsole Material': 'React Foam',
          'Outsole Material': 'Rubber',
          'Sole Thickness': '10 mm',
          Weight: '248 g',
          Gender: 'Men',
          Colour: 'Black',
          Surface: 'Road',
          Warranty: '6 months manufacturing',
        },
        partNumber: 'DM8963-001',
        colour: 'black',
      },
    ],
  },
  {
    id: 'prod-basmatirice',
    brand: 'Daawat',
    model: 'Basmati Rice',
    displayName: 'Daawat Traditional Basmati Rice',
    category: 'grocery',
    generation: '2024',
    imageUrl:
      'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&q=80&auto=format&fit=crop',
    highlights: ['Extra long grain basmati', 'Aged aroma', '5kg pack'],
    variants: [
      {
        label: '5kg pack',
        specs: {
          'Pack Size': '5 kg',
          'Shelf Life': '12 months',
          Vegetarian: 'Yes',
        },
        partNumber: 'DBR-5KG',
        colour: 'white',
      },
    ],
  },
];
