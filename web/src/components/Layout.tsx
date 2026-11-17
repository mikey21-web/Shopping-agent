import { Link, NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

const NAV = [
  { to: '/ask', label: 'Ask SahiPick', short: 'Ask' },
  { to: '/discover', label: 'Discover', short: 'Discover' },
  { to: '/compare', label: 'Compare', short: 'Compare' },
  { to: '/sources', label: 'Sources', short: 'Sources' },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-saffron-400 text-sm font-black text-ink-950">
              स
            </span>
            <span className="text-sm font-bold tracking-tight">
              Sahi<span className="text-saffron-400">Pick</span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    isActive
                      ? 'bg-ink-800 text-mist-50'
                      : 'text-mist-400 hover:bg-ink-850 hover:text-mist-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 sm:pb-10">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-800 bg-ink-950/95 backdrop-blur sm:hidden">
        <div className="grid grid-cols-4">
          {NAV.map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                  active ? 'text-saffron-400' : 'text-mist-500'
                }`}
              >
                <span aria-hidden className="text-base leading-none">
                  {item.short === 'Ask' ? '✦' : item.short === 'Discover' ? '◎' : item.short === 'Compare' ? '⇄' : '⛁'}
                </span>
                {item.short}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
