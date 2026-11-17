/**
 * EMI arithmetic.
 *
 * Deterministic and integer-based: every amount is paise, and rounding is
 * explicit so two runs on the same input always produce identical numbers.
 */

import type { EmiPlan } from '../../domain/types.ts';

export interface EmiQuote {
  months: number;
  monthlyPaise: number;
  interestRatePercent: number;
  totalPaise: number;
  interestPaise: number;
  processingFeePaise: number;
}

/**
 * Standard reducing-balance EMI formula.
 *   EMI = P * r * (1+r)^n / ((1+r)^n - 1)
 * with r = annual rate / 12 / 100.
 */
export function computeEmi(
  principalPaise: number,
  months: number,
  annualRatePercent: number,
  processingFeePaise = 0,
): EmiQuote | null {
  if (principalPaise <= 0 || months <= 0) return null;

  const monthlyRate = annualRatePercent / 12 / 100;
  let monthlyPaise: number;

  if (monthlyRate === 0) {
    monthlyPaise = Math.round(principalPaise / months);
  } else {
    const growth = Math.pow(1 + monthlyRate, months);
    monthlyPaise = Math.round((principalPaise * monthlyRate * growth) / (growth - 1));
  }

  const totalPaise = monthlyPaise * months + processingFeePaise;
  const interestPaise = Math.max(0, totalPaise - principalPaise);

  return {
    months,
    monthlyPaise,
    interestRatePercent: annualRatePercent,
    totalPaise,
    interestPaise,
    processingFeePaise,
  };
}

/** Convert an EMI quote into the domain shape used by the API. */
export function toEmiPlan(quote: EmiQuote): EmiPlan {
  return {
    months: quote.months,
    monthlyPaise: quote.monthlyPaise,
    interestRatePercent: quote.interestRatePercent,
    totalPaise: quote.totalPaise,
    processingFeePaise: quote.processingFeePaise,
  };
}
