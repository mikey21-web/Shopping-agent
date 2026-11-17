/**
 * Electronics category profiles.
 *
 * Each profile declares its own specification schema, the fields that define a
 * distinct variant, the buying criteria, the risks and the ownership cost
 * model. Adding a new electronics category means adding a profile here — no
 * change to the engine.
 */

import type { CategoryProfile } from './types.ts';
import { LAPTOP_COMPONENTS, SMARTPHONE_COMPONENTS } from '../recommendations/components.ts';

/* ------------------------------------------------------------------ */
/* Smartphone                                                          */
/* ------------------------------------------------------------------ */

export const smartphoneProfile: CategoryProfile = {
  id: 'smartphone',
  label: 'Smartphones',
  aliases: ['phone', 'mobile', 'smartphone', 'handset', 'iphone', 'android phone'],
  requestTerms: ['फोन', 'मोबाइल', 'स्मार्टफोन'],
  specialised: true,
  safetyCritical: false,
  requiresCertification: false,

  specFields: [
    { key: 'ramGb', label: 'RAM', type: 'number', unit: 'GB', aliases: ['ram', 'memory'], range: { min: 3, max: 24, ideal: 12 }, variantDefining: true, requiredForMatch: true },
    { key: 'storageGb', label: 'Storage', type: 'number', unit: 'GB', aliases: ['storage', 'rom'], range: { min: 32, max: 2048, ideal: 256 }, variantDefining: true, requiredForMatch: true },
    { key: 'soc', label: 'Processor', type: 'string', aliases: ['processor', 'chipset'], variantDefining: false, requiredForMatch: false },
    { key: 'cameraMainMp', label: 'Main camera', type: 'number', unit: 'MP', aliases: ['primary camera', 'main camera'], range: { min: 5, max: 200, ideal: 50 }, variantDefining: false, requiredForMatch: false },
    { key: 'batteryMah', label: 'Battery', type: 'number', unit: 'mAh', aliases: ['battery capacity', 'battery'], range: { min: 2000, max: 7000, ideal: 5000 }, variantDefining: false, requiredForMatch: false },
    { key: 'displaySizeIn', label: 'Display', type: 'number', unit: 'in', aliases: ['display size', 'screen size'], range: { min: 4.5, max: 7.8, ideal: 6.5 }, variantDefining: false, requiredForMatch: false },
    { key: 'refreshHz', label: 'Refresh rate', type: 'number', unit: 'Hz', aliases: ['refresh rate'], range: { min: 60, max: 144 }, variantDefining: false, requiredForMatch: false },
    { key: 'network', label: 'Network', type: 'enum', aliases: ['network', 'sim type'], values: ['5G', '4G', '3G'], variantDefining: true, requiredForMatch: false },
    { key: 'colour', label: 'Colour', type: 'string', aliases: ['colour', 'color'], variantDefining: true, requiredForMatch: false },
  ],
  variantFields: ['ramGb', 'storageGb', 'network', 'colour'],
  requiredMatchFields: ['ramGb', 'storageGb'],

  decisionDimensions: [
    { key: 'camera', label: 'Camera', keywords: ['camera', 'photo', 'photoshoot', 'कैमरा', 'फोटो'], description: 'Sensor quality, zoom reach and low-light behaviour.' },
    { key: 'battery', label: 'Battery', keywords: ['battery', 'backup', 'charge', 'बैटरी'], description: 'Capacity, charging speed and how much survives after a year.' },
    { key: 'performance', label: 'Performance', keywords: ['performance', 'fast', 'smooth', 'gaming', 'तेज़'], description: 'Chipset tier, memory and sustained performance.' },
    { key: 'display', label: 'Display', keywords: ['display', 'screen', 'डिस्प्ले'], description: 'Panel quality, refresh rate and brightness.' },
    { key: 'software', label: 'Software support', keywords: ['software', 'updates', 'os', 'सॉफ्टवेयर'], description: 'How long the device will receive OS and security updates.' },
    { key: 'value', label: 'Value for money', keywords: ['value', 'worth', 'best price', 'पैसा'], description: 'Capability per rupee against comparable models.' },
  ],

  reviewAspects: ['battery', 'heating', 'camera', 'display', 'performance', 'build_quality', 'software', 'durability', 'service', 'value', 'network', 'design'],

  risks: [
    {
      key: 'no_update_support',
      label: 'Unknown update support',
      severity: 'warning',
      evaluate: ({ specs }) =>
        !specs.os
          ? 'Operating system version is unknown, so update support cannot be confirmed.'
          : null,
    },
    {
      key: 'missing_warranty',
      label: 'Warranty not stated',
      severity: 'info',
      evaluate: ({ specs }) =>
        !specs.warrantyMonths ? 'No warranty period is published for this listing.' : null,
    },
  ],

  ownership: {
    label: 'Phone ownership',
    horizonYears: 4,
    note: 'Battery replacement is the main predictable cost, typically 25–35% of a new battery.',
    typicalAccessoryCostPaise: 250000,
  },

  // Scoring components are attached by the registry (they live in the
  // component library so they can be shared between categories).
  components: SMARTPHONE_COMPONENTS,
};

/* ------------------------------------------------------------------ */
/* Laptop                                                              */
/* ------------------------------------------------------------------ */

export const laptopProfile: CategoryProfile = {
  id: 'laptop',
  label: 'Laptops',
  aliases: ['laptop', 'notebook', 'macbook', 'computer', 'pc'],
  requestTerms: ['लैपटॉप', 'नोटबुक', 'कंप्यूटर'],
  specialised: true,
  safetyCritical: false,
  requiresCertification: false,

  specFields: [
    { key: 'ramGb', label: 'RAM', type: 'number', unit: 'GB', aliases: ['ram', 'memory'], range: { min: 4, max: 128, ideal: 32 }, variantDefining: true, requiredForMatch: true },
    { key: 'storageGb', label: 'Storage', type: 'number', unit: 'GB', aliases: ['storage', 'ssd'], range: { min: 128, max: 8192, ideal: 1024 }, variantDefining: true, requiredForMatch: true },
    { key: 'storageType', label: 'Storage type', type: 'string', aliases: ['storage type', 'rom type'], variantDefining: true, requiredForMatch: false },
    { key: 'soc', label: 'Processor', type: 'string', aliases: ['processor', 'cpu'], variantDefining: false, requiredForMatch: false },
    { key: 'displaySizeIn', label: 'Screen', type: 'number', unit: 'in', aliases: ['display size', 'screen size'], range: { min: 11, max: 20, ideal: 14 }, variantDefining: true, requiredForMatch: false },
    { key: 'batteryMah', label: 'Battery', type: 'number', unit: 'Wh', aliases: ['battery capacity', 'battery'], range: { min: 30, max: 120, ideal: 70 }, variantDefining: false, requiredForMatch: false },
    { key: 'weightKg', label: 'Weight', type: 'number', unit: 'kg', aliases: ['weight', 'product weight'], range: { min: 0.8, max: 3.5, ideal: 1.5 }, variantDefining: true, requiredForMatch: false },
  ],
  variantFields: ['ramGb', 'storageGb', 'storageType', 'displaySizeIn', 'colour'],
  requiredMatchFields: ['ramGb', 'storageGb'],

  decisionDimensions: [
    { key: 'performance', label: 'Processor', keywords: ['performance', 'fast', 'processor', 'cpu', 'development', 'programming', 'परफ़ॉर्मेंस'], description: 'CPU generation and sustained performance under load.' },
    { key: 'local_ai', label: 'Local AI capability', keywords: ['local ai', 'llm', 'llama', 'run models', 'ai'], description: 'Whether a dedicated GPU with usable VRAM is present.' },
    { key: 'memory', label: 'Memory & upgradeability', keywords: ['ram', 'memory', 'upgrade', 'रैम'], description: 'Capacity today and whether it can be upgraded later.' },
    { key: 'display', label: 'Display', keywords: ['display', 'screen', 'डिस्प्ले'], description: 'Panel, resolution and refresh rate.' },
    { key: 'battery', label: 'Battery life', keywords: ['battery', 'backup', 'बैटरी'], description: 'Real-world runtime and charging.' },
    { key: 'heating', label: 'Thermals', keywords: ['heating', 'heat', 'throttle', 'गर्म'], description: 'Whether sustained load causes throttling.' },
    { key: 'value', label: 'Value for money', keywords: ['value', 'worth', 'पैसा'], description: 'Capability per rupee.' },
  ],

  reviewAspects: ['battery', 'heating', 'display', 'performance', 'build_quality', 'software', 'durability', 'service', 'value', 'network', 'storage', 'compatibility'],

  risks: [
    {
      key: 'soldered_memory',
      label: 'Memory may be soldered',
      severity: 'warning',
      evaluate: ({ specs, extra }) => {
        const slots = extra['number of ram slots'] ?? extra['ram slots'];
        if (slots === undefined) return 'RAM slot count is unknown — upgradeability cannot be confirmed.';
        if (String(slots).trim() === '0') {
          return 'Memory is soldered and cannot be upgraded later.';
        }
        return null;
      },
    },
    {
      key: 'no_warranty',
      label: 'Warranty not stated',
      severity: 'info',
      evaluate: ({ specs }) =>
        !specs.warrantyMonths ? 'No warranty period is published for this listing.' : null,
    },
  ],

  ownership: {
    label: 'Laptop ownership',
    horizonYears: 5,
    note: 'Battery degradation and SSD size are the two costs that dominate over a laptop’s life.',
    typicalAccessoryCostPaise: 300000,
  },

  components: LAPTOP_COMPONENTS,
};

/* ------------------------------------------------------------------ */
/* Television                                                          */
/* ------------------------------------------------------------------ */

export const tvProfile: CategoryProfile = {
  id: 'tv',
  label: 'Televisions',
  aliases: ['tv', 'television', 'smart tv', 'oled', 'qled'],
  requestTerms: ['टीवी', 'टेलीविजन'],
  specialised: false,
  safetyCritical: false,
  requiresCertification: false,

  specFields: [
    { key: 'displaySizeIn', label: 'Screen size', type: 'number', unit: 'in', aliases: ['screen size', 'display size'], range: { min: 32, max: 85, ideal: 55 }, variantDefining: true, requiredForMatch: true },
    { key: 'displayPanel', label: 'Panel type', type: 'enum', aliases: ['panel type', 'display type'], values: ['OLED', 'QLED', 'Mini-LED', 'LED', 'VA', 'IPS'], variantDefining: true, requiredForMatch: false },
    { key: 'refreshHz', label: 'Refresh rate', type: 'number', unit: 'Hz', aliases: ['refresh rate'], range: { min: 24, max: 144 }, variantDefining: true, requiredForMatch: false },
    { key: 'hdmiPorts', label: 'HDMI ports', type: 'number', unit: 'ports', aliases: ['hdmi ports', 'hdmi'], range: { min: 2, max: 6 }, variantDefining: true, requiredForMatch: false },
  ],
  variantFields: ['displaySizeIn', 'displayPanel', 'refreshHz'],
  requiredMatchFields: ['displaySizeIn'],

  decisionDimensions: [
    { key: 'display', label: 'Picture quality', keywords: ['picture', 'panel', 'oled', 'display', 'resolution'], description: 'Panel type, contrast and brightness.' },
    { key: 'gaming', label: 'Gaming', keywords: ['gaming', 'ps5', 'xbox', 'latency', 'hz'], description: 'Refresh rate, input lag and HDMI bandwidth.' },
    { key: 'value', label: 'Value for money', keywords: ['value', 'worth'], description: 'Picture quality per rupee at a given size.' },
    { key: 'service', label: 'Service & warranty', keywords: ['warranty', 'service', 'installation'], description: 'Panel warranty and installation support.' },
  ],

  reviewAspects: ['display', 'value', 'service', 'durability', 'software', 'performance'],

  risks: [
    {
      key: 'panel_burn_in',
      label: 'OLED burn-in risk',
      severity: 'warning',
      evaluate: ({ specs }) =>
        String(specs.displayPanel ?? '').toUpperCase().includes('OLED')
          ? 'OLED panels can develop permanent image retention over years of static content.'
          : null,
    },
  ],

  ownership: {
    label: 'TV ownership',
    horizonYears: 8,
    note: 'Panel warranty usually covers 1–2 years while the panel itself is expected to last much longer.',
    typicalAccessoryCostPaise: 400000,
  },

  components: [],
};

/* ------------------------------------------------------------------ */
/* Audio (headphones, earbuds, speakers)                               */
/* ------------------------------------------------------------------ */

export const audioProfile: CategoryProfile = {
  id: 'audio',
  label: 'Headphones, earbuds & speakers',
  aliases: ['headphones', 'earbuds', 'earphones', 'speaker', 'bluetooth speaker', 'tws'],
  requestTerms: ['हेडफोन', 'ईयरबड्स', 'बड्स', 'स्पीकर'],
  specialised: false,
  safetyCritical: false,
  requiresCertification: false,

  specFields: [
    { key: 'formFactor', label: 'Form factor', type: 'enum', aliases: ['type', 'form factor', 'fit'], values: ['over-ear', 'on-ear', 'in-ear', 'open-ear', 'speaker'], variantDefining: true, requiredForMatch: true },
    { key: 'batteryMah', label: 'Battery', type: 'number', unit: 'mAh', aliases: ['battery', 'playback time'], range: { min: 30, max: 2000, ideal: 500 }, variantDefining: false, requiredForMatch: false },
    { key: 'anc', label: 'Active noise cancelling', type: 'boolean', aliases: ['anc', 'active noise cancellation', 'noise cancelling'], variantDefining: true, requiredForMatch: false },
    { key: 'driverMm', label: 'Driver size', type: 'number', unit: 'mm', aliases: ['driver size', 'driver'], range: { min: 6, max: 50 }, variantDefining: false, requiredForMatch: false },
    { key: 'interface', label: 'Interface', type: 'enum', aliases: ['interface', 'connector', 'connectivity'], values: ['usb-c', 'lightning', '3.5mm', 'bluetooth'], variantDefining: true, requiredForMatch: false },
  ],
  variantFields: ['formFactor', 'anc', 'interface', 'colour'],
  requiredMatchFields: ['formFactor'],

  decisionDimensions: [
    { key: 'audio', label: 'Sound quality', keywords: ['sound', 'audio', 'bass', 'treble', 'साउंड'], description: 'Tuning, detail and bass handling.' },
    { key: 'noise_cancellation', label: 'Noise cancellation', keywords: ['anc', 'noise cancellation', 'noise cancelling'], description: 'How well the ANC handles real-world noise.' },
    { key: 'battery', label: 'Battery', keywords: ['battery', 'playback', 'backup', 'बैटरी'], description: 'Real playback with ANC on.' },
    { key: 'comfort', label: 'Comfort & fit', keywords: ['comfort', 'fit', 'comfortable', 'आराम'], description: 'Long-session comfort and clamping force.' },
    { key: 'durability', label: 'Durability', keywords: ['durable', 'build', 'sturdy', 'बिल्ड'], description: 'Build quality and hinge/connector life.' },
  ],

  reviewAspects: ['audio', 'battery', 'durability', 'build_quality', 'compatibility', 'service', 'value'],

  risks: [
    {
      key: 'interface_mismatch',
      label: 'Connector may not fit your device',
      severity: 'warning',
      evaluate: ({ specs }) => {
        const iface = String(specs.interface ?? '').toLowerCase();
        if (iface === 'lightning') return 'This is the Lightning variant; newer iPhones use USB-C.';
        return null;
      },
    },
  ],

  ownership: {
    label: 'Audio ownership',
    horizonYears: 3,
    note: 'Ear-tip and case replacement are the usual recurring costs for in-ear models.',
    typicalAccessoryCostPaise: 80000,
  },

  components: [],
};

/* ------------------------------------------------------------------ */
/* Smartwatch                                                          */
/* ------------------------------------------------------------------ */

export const smartwatchProfile: CategoryProfile = {
  id: 'smartwatch',
  label: 'Smartwatches',
  aliases: ['smartwatch', 'smart watch', 'fitness band', 'wearable', 'watch'],
  requestTerms: ['स्मार्टवॉच', 'वॉच', 'घड़ी'],
  specialised: false,
  safetyCritical: false,
  requiresCertification: false,

  specFields: [
    { key: 'displaySizeIn', label: 'Display size', type: 'number', unit: 'in', aliases: ['display size', 'screen size'], range: { min: 0.9, max: 2.1, ideal: 1.4 }, variantDefining: true, requiredForMatch: true },
    { key: 'batteryMah', label: 'Battery', type: 'number', unit: 'mAh', aliases: ['battery', 'battery life'], range: { min: 150, max: 900, ideal: 400 }, variantDefining: false, requiredForMatch: false },
    { key: 'waterResistance', label: 'Water resistance', type: 'string', aliases: ['water resistance', 'ip rating'], variantDefining: true, requiredForMatch: false },
    { key: 'gps', label: 'GPS', type: 'boolean', aliases: ['gps'], variantDefining: true, requiredForMatch: false },
  ],
  variantFields: ['displaySizeIn', 'waterResistance', 'gps'],
  requiredMatchFields: ['displaySizeIn'],

  decisionDimensions: [
    { key: 'battery', label: 'Battery', keywords: ['battery', 'backup', 'days', 'बैटरी'], description: 'Real days between charges with always-on display.' },
    { key: 'fitness', label: 'Fitness tracking', keywords: ['fitness', 'workout', 'gym', 'heart rate', 'spo2'], description: 'Sensor accuracy for health metrics.' },
    { key: 'battery', label: 'Compatibility', keywords: ['android', 'ios', 'iphone', 'calls', 'notifications'], description: 'Phone pairing, notifications and call support.' },
    { key: 'value', label: 'Value for money', keywords: ['value', 'worth'], description: 'Features per rupee.' },
  ],

  reviewAspects: ['battery', 'performance', 'durability', 'software', 'compatibility', 'value', 'design'],

  risks: [
    {
      key: 'ecosystem_lock',
      label: 'Ecosystem limitation',
      severity: 'info',
      evaluate: ({ specs }) =>
        specs.os === 'iOS' || specs.os === 'watchOS'
          ? 'This model is tied to the Apple ecosystem and will not pair with Android properly.'
          : null,
    },
  ],

  ownership: {
    label: 'Watch ownership',
    horizonYears: 4,
    note: 'Strap replacement is the main consumable; sensors degrade slowly in smartwatches.',
    typicalAccessoryCostPaise: 120000,
  },

  components: [],
};

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

export const cameraProfile: CategoryProfile = {
  id: 'camera',
  label: 'Cameras',
  aliases: ['camera', 'dslr', 'mirrorless', 'point and shoot', 'lens', 'action camera'],
  requestTerms: ['कैमरा', 'लेंस'],
  specialised: false,
  safetyCritical: false,
  requiresCertification: false,

  specFields: [
    { key: 'sensorMp', label: 'Sensor resolution', type: 'number', unit: 'MP', aliases: ['effective megapixels', 'resolution', 'megapixel'], range: { min: 8, max: 100, ideal: 24 }, variantDefining: false, requiredForMatch: false },
    { key: 'sensorSize', label: 'Sensor size', type: 'string', aliases: ['sensor size', 'sensor'], variantDefining: true, requiredForMatch: false },
    { key: 'isoRange', label: 'Max ISO', type: 'number', unit: 'ISO', aliases: ['max iso', 'iso'], range: { min: 3200, max: 102400 }, variantDefining: false, requiredForMatch: false },
    { key: 'videoResolution', label: 'Video', type: 'string', aliases: ['video', 'video resolution'], variantDefining: true, requiredForMatch: false },
  ],
  variantFields: ['sensorSize', 'videoResolution', 'colour'],
  requiredMatchFields: [],

  decisionDimensions: [
    { key: 'image_quality', label: 'Image quality', keywords: ['photo', 'image', 'quality', 'low light'], description: 'Sensor, glass and processing.' },
    { key: 'video', label: 'Video', keywords: ['video', '4k', '8k', 'fps', 'stabilisation'], description: 'Recording formats, stabilisation and rolling shutter.' },
    { key: 'lens', label: 'Lens ecosystem', keywords: ['lens', 'mount', 'focal length', 'zoom'], description: 'Lens availability and focal lengths.' },
    { key: 'durability', label: 'Durability', keywords: ['durable', 'weather sealing', 'dust'], description: 'Weather sealing and body durability.' },
  ],

  reviewAspects: ['performance', 'durability', 'build_quality', 'battery', 'software', 'value', 'compatibility'],

  risks: [
    {
      key: 'no_weather_sealing',
      label: 'No weather sealing stated',
      severity: 'info',
      evaluate: ({ specs }) =>
        !specs.warrantyMonths ? 'Warranty and weather-sealing details are not published.' : null,
    },
  ],

  ownership: {
    label: 'Camera ownership',
    horizonYears: 7,
    note: 'Memory cards, spare batteries and a bag are the usual first-year additions.',
    typicalAccessoryCostPaise: 800000,
  },

  components: [],
};
