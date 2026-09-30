'use client';

import { cn } from '@/lib/utils';

/**
 * The brand mark, drawn rather than shipped as an image.
 *
 * The three shapes below are the app icon's (`public/icons/icon.svg`), kept in
 * step by hand because there are three of them and they are five lines each. The
 * point of drawing it inline is that the mark can be *the current colour*: it
 * renders in the accent on the boot screen, in `muted-fg` next to a settings
 * footer, and in cream on the accent tile of an empty state, all from one
 * component and with no second asset per theme.
 *
 * The viewBox is the ribbon's own bounding box — `164 140 184 228` in the icon's
 * coordinates — so the mark fills whatever box it is given with no padding to
 * guess at. That is also why there is no `preserveAspectRatio` override: the
 * ribbon's ratio is the ratio, and stretching it would be the one thing that
 * makes a drawn mark look wrong.
 */
const RIBBON =
  'M 204 140 H 308 Q 348 140 348 180 V 352 Q 348 368 336 368 L 268 322 Q 256 317 244 322 L 176 368 Q 164 368 164 352 V 180 Q 164 140 204 140 Z';

export interface LogoMarkProps {
  /** Rendered height in pixels. The width follows the ribbon's own ratio. */
  size?: number;
  className?: string;
}

/** The ribbon alone, in `currentColor`. */
export function LogoMark({ size = 24, className }: LogoMarkProps) {
  return (
    <svg
      viewBox="164 140 184 228"
      height={size}
      style={{ height: size, width: 'auto' }}
      className={cn('shrink-0', className)}
      role="presentation"
      aria-hidden="true"
    >
      <path d={RIBBON} fill="currentColor" />
    </svg>
  );
}

/**
 * The mark on its tile, for the places that want the *app icon* rather than a
 * glyph: the boot screen, an empty state, a share card.
 *
 * The tile is `--brand-ink` rather than the accent, because the icon is the one
 * surface that has to hold its own next to every other app on a home screen, and
 * a deep ink tile with a cream mark does that better than a bright one. The
 * `size` is the tile's edge; the mark inside is 54% of it, which is the
 * proportion the icon was drawn at.
 */
export function LogoTile({ size = 56, className }: LogoMarkProps) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center bg-brand-ink', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden="true"
    >
      <LogoMark size={Math.round(size * 0.54)} className="text-brand-cream" />
    </span>
  );
}

/**
 * Mark plus wordmark.
 *
 * The wordmark is set in the app's own type rather than drawn as outlines: it
 * stays crisp at any size, it follows the reader's font settings, and it cannot
 * drift from the type scale the rest of the app uses.
 */
export function LogoLockup({
  size = 40,
  subtitle,
  className,
}: {
  size?: number;
  subtitle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoTile size={size} />
      <div className="min-w-0">
        <p className="text-title font-semibold tracking-tight text-fg">Stash</p>
        {subtitle ? <p className="text-meta text-muted">{subtitle}</p> : null}
      </div>
    </div>
  );
}
