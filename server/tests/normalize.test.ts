import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRamGb,
  parseStorageGb,
  parseStorageType,
  parseSoc,
  parseDisplaySizeIn,
  parseRefreshHz,
  parseBatteryMah,
  parseCameraMainMp,
  parsePriceToPaise,
  formatPaise,
  normalizeSpecs,
  normalizeColour,
  parseWarrantyMonths,
} from '../src/intelligence/normalize/specs.ts';

describe('spec normalisation', () => {
  it('parses RAM written in several ways', () => {
    assert.equal(parseRamGb('16GB DDR4'), 16);
    assert.equal(parseRamGb('16 GB'), 16);
    assert.equal(parseRamGb('16GB RAM'), 16);
    assert.equal(parseRamGb('8GB + 8GB'), 16);
    assert.equal(parseRamGb('8192MB'), 8);
    assert.equal(parseRamGb(''), null);
    assert.equal(parseRamGb(null), null);
  });

  it('parses storage to gigabytes using binary multiples for TB', () => {
    assert.equal(parseStorageGb('1TB SSD'), 1024);
    assert.equal(parseStorageGb('1 TB'), 1024);
    assert.equal(parseStorageGb('512GB'), 512);
    assert.equal(parseStorageGb('2TB SSD'), 2048);
    assert.equal(parseStorageGb('128 GB'), 128);
  });

  it('detects storage type', () => {
    assert.equal(parseStorageType('1TB PCIe NVMe SSD'), 'NVMe');
    assert.equal(parseStorageType('512GB SSD'), 'SSD');
    assert.equal(parseStorageType('256GB UFS 3.1'), 'UFS 3.1');
    assert.equal(parseStorageType('64GB eMMC'), 'eMMC');
    assert.equal(parseStorageType('1TB Hard Disk'), 'HDD');
  });

  it('detects chipset families', () => {
    assert.equal(parseSoc('Intel Core Ultra 7 155H').family, 'intel_core_ultra');
    assert.equal(parseSoc('Snapdragon 8 Gen 3').family, 'snapdragon');
    assert.equal(parseSoc('MediaTek Dimensity 9300').family, 'mediatek_dimensity');
    assert.equal(parseSoc('Exynos 2400').family, 'exynos');
    assert.equal(parseSoc('AMD Ryzen 7 8845HS').family, 'amd_ryzen');
    assert.equal(parseSoc('Apple M3 Pro').family, 'apple');
  });

  it('parses display, refresh rate and battery', () => {
    assert.equal(parseDisplaySizeIn('6.8 inches'), 6.8);
    assert.equal(parseDisplaySizeIn('15.6"'), 15.6);
    assert.equal(parseRefreshHz('120Hz'), 120);
    assert.equal(parseBatteryMah('5000 mAh'), 5000);
  });

  it('parses the main camera megapixels from a multi-camera string', () => {
    assert.equal(parseCameraMainMp('50MP + 12MP + 10MP'), 50);
    assert.equal(parseCameraMainMp('200MP'), 200);
    assert.equal(parseCameraMainMp('64MP'), 64);
  });

  it('converts prices to paise without floating point drift', () => {
    assert.equal(parsePriceToPaise('₹1,29,999'), 12999900);
    assert.equal(parsePriceToPaise('Rs. 129999.50'), 12999950);
    assert.equal(parsePriceToPaise(1299.99), 129999);
    assert.equal(parsePriceToPaise('free'), null);
  });

  it('formats paise using Indian digit grouping', () => {
    assert.equal(formatPaise(12999900), '₹1,29,999');
    assert.equal(formatPaise(4500000), '₹45,000');
    assert.equal(formatPaise(null), '—');
  });

  it('normalises colour names without collapsing distinct colours', () => {
    // "Titanium Grey" and "Grey" are different colours and must not collapse.
    assert.equal(normalizeColour('Titanium Gray'), 'titanium grey');
    assert.equal(normalizeColour('Silver'), 'silver');
    assert.equal(normalizeColour('Gray'), 'grey');
    assert.equal(normalizeColour('Grey'), 'grey');
    assert.equal(normalizeColour('Deep Midnight Black'), 'midnight black');
  });

  it('parses warranty duration', () => {
    assert.equal(parseWarrantyMonths('1 year warranty'), 12);
    assert.equal(parseWarrantyMonths('18 months'), 18);
  });

  it('normalises a full spec sheet and preserves unknown fields', () => {
    const specs = normalizeSpecs({
      RAM: '16GB DDR5',
      'Storage Capacity': '1TB PCIe SSD',
      Processor: 'Intel Core Ultra 7 155H',
      'Display Size': '14 inches',
      'Refresh Rate': '120Hz',
      'Battery Capacity': '75 Wh',
      'Operating System': 'Windows 11 Home',
      'Number of RAM Slots': '2',
    });

    assert.equal(specs.ramGb, 16);
    assert.equal(specs.storageGb, 1024);
    assert.equal(specs.socFamily, 'intel_core_ultra');
    assert.equal(specs.displaySizeIn, 14);
    assert.equal(specs.refreshHz, 120);
    assert.equal(specs.os, 'Windows');
    // Unknown keys are preserved rather than dropped.
    assert.equal(specs.extra['number of ram slots'], '2');
  });
});
