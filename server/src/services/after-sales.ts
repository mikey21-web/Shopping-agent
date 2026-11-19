import { randomUUID } from 'node:crypto';

import type { Product } from '../domain/types.ts';
import { getProduct as getProductRow } from '../db/repositories.ts';
import { run, select } from '../db/index.ts';

export interface ProductServiceCoverage {
  productId: string;
  retailer: string;
  providerName: string;
  warrantyYears: number;
  warrantyDays: number;
  responseHours: number;
  returnsDays: number;
  shippingDays: number;
  warrantyClaimed: boolean;
}

export interface AfterSalesIssue {
  productId: string;
  category: string;
  symptom: string;
  reportRatio: number;
}

export interface AfterSalesScore {
  productId: string;
  category: string | null;
  score: number;
  coverage: ProductServiceCoverage;
  issues: AfterSalesIssue[];
  reasons: string[];
}

export interface PurchaseRecord {
  id: string;
  shopperId: string;
  productId: string;
  variantId: string | null;
  category: string;
  purchasedAt: string;
  sourceUrl: string | null;
  pricePaise: number | null;
  source: 'web' | 'whatsapp' | 'import';
  notes: string | null;
}

interface CoverageRow {
  id: string;
  product_id: string;
  retailer: string;
  provider_name: string | null;
  warranty_years: number | null;
  warranty_days: number | null;
  response_hours: number | null;
  returns_days: number | null;
  shipping_days: number | null;
  warranty_claimed: number;
  created_at: string;
  updated_at: string;
}

function mapCoverage0(row: CoverageRow): number {
  const years = row.warranty_years ?? 1;
  return row.warranty_days ?? years * 365;
}

function mapCoverage(row: CoverageRow, product: Product | null): ProductServiceCoverage {
  return {
    productId: row.product_id,
    retailer: row.retailer,
    providerName: row.provider_name ?? product?.brand ?? row.retailer,
    warrantyYears: row.warranty_years ?? 1,
    warrantyDays: row.warranty_days ?? mapCoverage0(row),
    responseHours: row.response_hours ?? 72,
    returnsDays: row.returns_days ?? 30,
    shippingDays: row.shipping_days ?? 14,
    warrantyClaimed: row.warranty_claimed === 1,
  };
}

function defaultCoverage(product: Product | null, retailer: string): ProductServiceCoverage {
  return {
    productId: product?.id ?? 'unknown',
    retailer,
    providerName: product?.brand ?? retailer,
    warrantyYears: 1,
    warrantyDays: 365,
    responseHours: 168,
    returnsDays: 30,
    shippingDays: 14,
    warrantyClaimed: true,
  };
}

export function getProductServiceCoverage(productId: string, retailer?: string): ProductServiceCoverage | null {
  const product = getProductRow(productId);
  const row = select<CoverageRow>(
    `SELECT * FROM product_service_coverage
      WHERE product_id = ?${retailer ? ' AND retailer = ?' : ''}
      ORDER BY updated_at DESC LIMIT 1`,
    ...(retailer ? [productId, retailer] : [productId]),
  )[0];
  return row ? mapCoverage(row, product) : null;
}

export function scoreProductAfterSales(productId: string, retailer?: string): AfterSalesScore {
  const product = getProductRow(productId);
  const coverage = getProductServiceCoverage(productId, retailer) ?? defaultCoverage(product, retailer ?? 'default');
  const issues = select<{
    product_id: string;
    category: string;
    symptom: string;
    report_ratio: number;
  }>('SELECT * FROM after_sales_issues WHERE product_id = ?', productId).map((row) => ({
    productId: row.product_id,
    category: row.category,
    symptom: row.symptom,
    reportRatio: row.report_ratio,
  }));

  const reasons: string[] = [];
  let risk = 0;

  if (!coverage.warrantyClaimed) {
    reasons.push('No advertised warranty for this retailer/product.');
    risk += 0.25;
  } else if (coverage.warrantyYears < 1) {
    reasons.push('Warranty is shorter than one year.');
    risk += 0.35;
  } else if (coverage.warrantyYears === 1) {
    reasons.push('One-year warranty is the usual baseline for this category.');
    risk += 0.12;
  }
  if (coverage.responseHours > 72) {
    reasons.push(`Average response is about ${coverage.responseHours}h; service waits can be long.`);
    risk += 0.2;
  }
  if (coverage.returnsDays < 30) {
    reasons.push(`Returns are limited to ${coverage.returnsDays} days.`);
    risk += 0.1;
  }
  if (coverage.shippingDays > 14) {
    reasons.push(`Return/replacement shipping is about ${coverage.shippingDays} days.`);
    risk += 0.08;
  }
  if (issues.length > 0) {
    const issueRisk = issues.reduce((sum, issue) => sum + Math.min(issue.reportRatio, 1) * 0.22, 0);
    reasons.push(...issues.slice(0, 3).map((issue) => `Known ${issue.symptom} risk (about ${Math.round(issue.reportRatio * 100)}% reports).`));
    risk += Math.min(issueRisk, 0.4);
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - risk * 100)));
  return {
    productId,
    category: product?.category ?? null,
    score,
    coverage,
    issues,
    reasons,
  };
}

export function recordPurchase(purchase: PurchaseRecord): void {
  run(
    `INSERT INTO purchases (
       id, shopper_id, product_id, variant_id, category, purchased_at,
       source_url, price_paise, source, notes
     ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    purchase.id,
    purchase.shopperId,
    purchase.productId,
    purchase.variantId,
    purchase.category,
    purchase.purchasedAt,
    purchase.sourceUrl,
    purchase.pricePaise,
    purchase.source,
    purchase.notes,
  );
}

export function listPurchasesByShopper(shopperId: string, limit = 50): PurchaseRecord[] {
  return select<{
    id: string;
    shopper_id: string;
    product_id: string;
    variant_id: string | null;
    category: string;
    purchased_at: string;
    source_url: string | null;
    price_paise: number | null;
    source: string;
    notes: string | null;
  }>(
    'SELECT * FROM purchases WHERE shopper_id = ? ORDER BY purchased_at DESC LIMIT ?',
    shopperId,
    limit,
  ).map((row) => ({
    id: row.id,
    shopperId: row.shopper_id,
    productId: row.product_id,
    variantId: row.variant_id,
    category: row.category,
    purchasedAt: row.purchased_at,
    sourceUrl: row.source_url,
    pricePaise: row.price_paise,
    source: row.source as PurchaseRecord['source'],
    notes: row.notes,
  }));
}

export function nextPurchaseId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
