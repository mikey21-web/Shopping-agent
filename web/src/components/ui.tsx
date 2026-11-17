/** Small presentational primitives shared across the app. */

import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag
      className={`rounded-2xl border border-ink-700/70 bg-ink-900/70 backdrop-blur-sm ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-mist-50">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-mist-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  neutral: 'bg-ink-800 text-mist-400 border-ink-600/60',
  jade: 'bg-jade-500/12 text-jade-300 border-jade-500/30',
  saffron: 'bg-saffron-500/12 text-saffron-300 border-saffron-500/30',
  sky: 'bg-sky-400/12 text-sky-300 border-sky-400/30',
  rose: 'bg-rose-400/12 text-rose-300 border-rose-400/30',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled = false,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'outline';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const variants = {
    primary:
      'bg-saffron-400 text-ink-950 hover:bg-saffron-300 disabled:bg-ink-700 disabled:text-mist-500 font-semibold',
    outline:
      'border border-ink-600 text-mist-200 hover:border-saffron-400/60 hover:text-saffron-300',
    ghost: 'text-mist-400 hover:text-mist-50 hover:bg-ink-800',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  title,
  message,
  icon = '◎',
}: {
  title: string;
  message: string;
  icon?: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-3xl text-ink-500">{icon}</div>
      <h3 className="text-sm font-semibold text-mist-100">{title}</h3>
      <p className="max-w-md text-xs leading-relaxed text-mist-500">{message}</p>
    </Card>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-400/30 bg-rose-400/8 px-4 py-3 text-xs leading-relaxed text-rose-300">
      {message}
    </div>
  );
}

/** A horizontal bar used for score breakdowns. */
export function ScoreBar({
  value,
  tone = 'saffron',
}: {
  value: number;
  tone?: 'saffron' | 'jade' | 'sky' | 'rose';
}) {
  const colors = {
    saffron: 'bg-saffron-400',
    jade: 'bg-jade-400',
    sky: 'bg-sky-400',
    rose: 'bg-rose-400',
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
      <div
        className={`h-full rounded-full ${colors[tone]}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}
