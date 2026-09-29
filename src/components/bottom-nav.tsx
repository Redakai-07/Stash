'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Library, NotebookPen, Search, Settings, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Primary navigation.
 *
 * Five destinations, which is the practical limit for a thumb-reachable bar on a
 * phone: Home answers "what did I just save", Library is where structure lives,
 * Notes is where the user's own writing lives, Search finds anything, and
 * Settings holds the rare, destructive things.
 */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/notes', label: 'Notes', icon: NotebookPen },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav
      aria-label="Primary"
      className="z-40 shrink-0 border-t border-border bg-surface/95 pb-safe backdrop-blur-xl"
    >
      <ul className="flex items-stretch">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const TabIcon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="tap flex h-14 flex-col items-center justify-center gap-1 rounded-xl"
              >
                <span
                  className={cn(
                    'flex h-7 w-10 items-center justify-center rounded-full transition-colors duration-200',
                    active ? 'bg-accent-soft' : 'bg-transparent',
                  )}
                >
                  <TabIcon
                    size={18}
                    strokeWidth={active ? 2.2 : 1.8}
                    className={cn('transition-colors duration-200', active ? 'text-accent' : 'text-subtle')}
                    aria-hidden
                  />
                </span>
                <span
                  className={cn(
                    'text-label leading-none font-medium tracking-tight transition-colors duration-200',
                    active ? 'text-accent' : 'text-subtle',
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
