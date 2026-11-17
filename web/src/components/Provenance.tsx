import type { Provenance } from '../lib/api.ts';
import { Badge } from './ui.tsx';

/**
 * Provenance badge.
 *
 * Every price or fact that came from outside SahiPick shows where it came
 * from. Sample data is always visible as sample data — this is the single most
 * important honesty affordance in the product.
 */
export function ProvenanceBadge({
  provenance,
  compact = false,
}: {
  provenance: Provenance | null | undefined;
  compact?: boolean;
}) {
  if (!provenance) {
    return (
      <Badge tone="neutral" className={compact ? 'text-[10px]' : ''}>
        <span className="text-mist-500">Source unknown</span>
      </Badge>
    );
  }

  switch (provenance.origin) {
    case 'live':
      return (
        <Badge tone="jade" className={compact ? 'text-[10px]' : ''}>
          <span aria-hidden>●</span> Live data · {provenance.source}
        </Badge>
      );
    case 'sample':
      return (
        <Badge tone="saffron" className={compact ? 'text-[10px]' : ''}>
          <span aria-hidden>◆</span> Sample data
        </Badge>
      );
    case 'derived':
      return (
        <Badge tone="sky" className={compact ? 'text-[10px]' : ''}>
          <span aria-hidden>◇</span> Computed by SahiPick
        </Badge>
      );
    case 'model_est':
      return (
        <Badge tone="neutral" className={compact ? 'text-[10px]' : ''}>
          <span aria-hidden>◇</span> Model estimate — unverified
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral" className={compact ? 'text-[10px]' : ''}>
          <span className="text-mist-500">Unverified</span>
        </Badge>
      );
  }
}

/** Inline warning strip used when sample data is present. */
export function SampleDataNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-saffron-500/25 bg-saffron-500/8 px-3 py-2 text-[11px] leading-relaxed text-saffron-300">
      <span aria-hidden className="mt-0.5">
        ◆
      </span>
      <span>{message}</span>
    </div>
  );
}
