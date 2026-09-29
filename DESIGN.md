# Stash — design system

This is the authored design language of Stash. It exists so the app does not
drift back into looking machine-made: the failure mode is not "ugly", it is
*generic* — card after rounded card, a rainbow of icons, a container around
every thought, decoration standing in for hierarchy.

Read this before changing UI. If a change cannot be justified by a rule here,
the rule is probably right and the change is probably wrong — or this document
needs a deliberate edit, which is a decision, not an accident.

Tokens live in `src/app/globals.css`. Primitives live in `src/components/ui/`.
Screens compose those; they do not invent new visual vocabulary.

---

## 1. The direction

**A quiet, tactile drawer of things worth keeping.**

Stash is a private utility someone opens many times a day to file something or
find something. It is not a dashboard, not a social product, not a showcase. The
interface should feel like a well-made index card box: plain, sturdy, and
precise, with everything in its place.

Three rules produce everything else:

1. **Hierarchy is typographic.** Size, weight, position and space carry it.
   Remove nearly every border from a screen and it must still read.
2. **Depth is a step plus a hairline.** Surfaces differ by a barely-perceptible
   tone; the line between them does the grouping. Large filled containers are
   reserved for things genuinely raised off the page.
3. **Colour is a signal.** One accent for the primary action and the current
   selection; semantic colours only where meaning demands them.

Corollary: **design from content, not from components.** Start with "what does
the user need to know here", not "I need a Card". A folder is a name, a count
and a way in — that is a row, not a tile.

---

## 2. Forbidden patterns

These are the specific tells of generated UI. None of them are in the app, and
none of them may be added:

- gradient hero cards, gradient buttons, gradient text, "AI purple/blue" palettes;
- glassmorphism, glowing borders, floating blobs, decorative sparkles;
- a container around every element: card-inside-card, a box per list row, a
  rounded tile behind every icon;
- `rounded-2xl` on everything (see §5 — shape is a vocabulary);
- random icon colours, or an icon on every label "for balance";
- giant page titles and oversized headings that push content below the fold;
- pill-shaped chips for everything, badge soup, stat tiles, dashboards, scores;
- excessive explanatory copy, duplicated labels (title + subtitle saying the
  same thing), all-uppercase section labels with wide tracking;
- animation for its own sake: on-load floats, staggered reveals, bouncing icons,
  ambient motion, spring overshoot;
- grey slabs on black, or white cards floating on grey — in either theme.

If something *feels* premium because it is loud, it is wrong. Premium here means
fast, calm and exact.

---

## 3. Typography

Six steps, each with one job. New UI picks a step; it never picks a raw size.

| Token         | Size | Job                                            |
| ------------- | ---- | ---------------------------------------------- |
| `text-display`| 21px | the page title — one per screen                |
| `text-title`  | 16px | sheet and dialog titles                        |
| `text-row`    | 15px | list-item titles (the most common text)        |
| `text-body`   | 14px | prose the user reads or writes                 |
| `text-meta`   | 13px | the secondary line under a row title           |
| `text-label`  | 12px | section labels                                 |

Rules:

- Weight does the emphasis: `font-semibold` for titles, `font-medium` for row
  titles, regular for prose. Avoid bold-everywhere.
- Section labels are sentence case, no letter-spacing, `text-subtle`. They are
  signposts, not eyebrows.
- Two weights of secondary ink: `text-muted` for content the user reads,
  `text-subtle` for metadata that is never load-bearing. Do not stack three
  greys in one row.
- Truncate, never wrap, in rows. A row is one line of title plus one line of
  metadata, full stop.

---

## 4. Spacing and density

- 4px base unit. In practice: `px-4` page gutter, `py-3` row padding, `gap-3`
  inside a row, `mt-7` between sections, `pb-1` under a section label.
- Rows are compact on purpose. Twenty links must fit on a phone screen; every
  pixel spent on air is a link the user has to scroll for.
- One gutter everywhere (16px), so lists line up from screen to screen.
- A row is: title line, optional metadata line, optional trailing controls.
  Nothing else.

---

## 5. Shape

Radius is a vocabulary with three words, not a default:

| Token                | Use                                                     |
| -------------------- | ------------------------------------------------------- |
| `rounded-tap`  (8px) | controls *inside* content (a small inline button)        |
| `rounded-xl`  (10px) | a real button or a field                                 |
| `rounded-2xl` (16px) | a surface that floats above the page (sheet, dialog)     |
| — none —             | content rows and grouped lists; hairlines, not corners   |

The fourth role is the absence of a class. A list row is square with a hairline
under it. Tailwind's stock steps are retuned so a stray `rounded-2xl` cannot
reintroduce a louder shape.

`rounded-full` is reserved for: the primary floating action, the grab handle, and
circular icon buttons in a row (`size-10`). That is the whole list.

---

## 6. Colour and surface

One accent — ink-indigo — used for: the primary action, the current selection,
links-in-context, focus, and nothing else. Away from that: neutral.

Surfaces, in a deliberately small ladder (light → dark):

- `bg` — the paper. What most of the screen is.
- `surface` — chrome raised off the paper: sheets, bars, toasts, grouped blocks.
- `surface-2` — an inset: a field, a pressed row, a well.
- `surface-3` — one step further in, for pressed states of insets.

Semantic colours are used only when they mean something: `danger` for
destructive actions and a link the user marked dead; `warning` for a favourite
star; `success` for a confirmation toast. Never for variety.

Dark mode is not inverted light mode and is never `#000`. Surfaces step
`oklch(0.155 → 0.185 → 0.212 → 0.248)`, so depth reads as material rather than
as holes. Text tops out just below pure white.

Both themes are defined once in `src/app/globals.css`; components never branch on
theme. `color-scheme` follows the resolved theme, and `--chrome-gap` (§10) is
shared by both.

---

## 7. Icons

- One family: Lucide, `size` 14–24, `strokeWidth` ~1.8–2.2.
- An icon earns its place by clarifying an action or a state: a lock on locked
  content, a star on a favourite, a chevron on a drill-down.
- No icon containers, no tinted squares behind icons, no coloured icons.
- Icons are `aria-hidden` unless they carry meaning alone — and if they carry
  meaning, they get an `aria-label` (see the lock/star/unavailable marks).
- Leading glyphs in rows are muted and small (`text-subtle`); they are structure,
  not decoration. A folder's glyph is part of the information architecture, so it
  is one neutral mark, not a coloured sticker.

---

## 8. Rows, lists, folders

The row is the app. It is deliberately boring:

```
Title                                    ☆   ⋯
source · tag · note · 14h ago
──────────────────────────────────────────────
```

- Full-bleed hairline under each row (`divide-y divide-hairline`), no per-row
  background, no per-row radius, no per-row shadow.
- The whole row is the touch target (`py-3`, ≥44px). Trailing controls are
  `size-10` circular buttons so a thumb cannot miss.
- Metadata order is fixed: source → tags → context → "note" → relative time.
- State marks ride the title line (lock, favourite, unavailable) so they are
  visible while scanning.
- Grouped blocks (Settings-style) are the one place a container earns an edge:
  `GroupSurface` says "these rows are one thing".
- Long-press is a shortcut to the same action sheet the ⋯ button opens. Never
  long-press-only: the visible button is what makes it discoverable.

---

## 9. Sheets, dialogs, menus

- Bottom sheets for anything thumb-reachable: all item actions, move/copy
  destination pickers, capture, import.
- Sheets: `rounded-t-2xl`, `border-t border-hairline`, `bg-surface`,
  `shadow-sheet`, grab handle, header, scrolling body, pinned footer with
  `pb-safe`.
- Action menus use `ActionList` / `ActionRow`: rows and hairlines, muted icons,
  the destructive row in `danger` and last. A five-item menu must not be five
  boxes.
- A dialog is reserved for a decision that needs an explicit answer
  (destructive confirmation). It is centred, `rounded-2xl`, `shadow-raised`.
- Confirmation copy names the item and the consequence. Never "Are you sure?".
- Destructive flows are two-step (delete → trash → purge), never one-step
  surprise.

---

## 10. System chrome, insets and the back button

**Insets.** Android paints edge to edge from API 35, and Capacitor 8's bundled
SystemBars plugin publishes the insets as `--safe-area-inset-*` custom
properties — which stay correct on every WebView version, including the older
ones where Capacitor pads the WebView natively and reports zero. So the safe
utilities read the custom property and fall back to `env()`:

```css
padding-top: calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + var(--chrome-gap));
```

- `pt-safe` / `pb-safe` add `--chrome-gap` (8px) on top of the inset. Those are
  the two edges where app chrome meets a system bar, and the gap is what keeps
  the clock and the gesture pill out of the header and the tab bar.
- `px-safe` handles landscape cutouts and adds nothing of its own.
- Nothing else may hand-roll `env(safe-area-inset-*)`.
- Because Capacitor zeroes the variables when it pads natively, the app never
  pads twice — do not "fix" that by removing the fallback chain.

**Bar appearance.** The system bars are styled from the app's *resolved* theme,
not the device's, via `syncSystemBars` (§`src/lib/system-bars.ts`). A light app
on a dark device would otherwise get dark icons on a dark background.

**Back button.** Back is owned by the app, in this order:

1. close the topmost overlay (the overlay stack in `src/lib/overlays.ts`);
2. walk the screen hierarchy (`?folder=`, `?note=` nesting), falling back to
   Home when a screen was opened cold;
3. at Home, ask before leaving — twice within two seconds exits.

The canonical rules and their tests are in `src/lib/back.ts` and
`tests/back.test.ts`. Never leave a screen with no way back, and never let one
press of back drop the user out of the app.

---

## 11. Locked content

The lock is a product feature with a visual grammar, so it has rules like any
other part of the system.

- **A locked item keeps its row.** It does not vanish from the list. The row
  shows a single accent padlock, the words "Locked note / link / folder", the
  timestamp it still knows, and "unlock to read". Nothing on that row is derived
  from the content, because none of it exists in the clear: a locked folder's
  name was never stored.
- **Tapping it asks the same question the lock screen does** — the device prompt
  where one is armed (`BiometricPrompt` on Android, Windows Hello on desktop),
  the passcode where it is not. Never a silent no-op, never a dead end.
- **The prompt comes first and runs on arrival** on the lock gate, because the
  point of a device lock is that there is nothing to type. The passcode sits
  underneath it, behind one tap, named "Use your Stash passcode".
- **Name the platform dialog.** "Windows Hello or your device PIN" on a PC,
  "your fingerprint, face or phone PIN" on a phone. Never "biometrics".
- **Say what it costs, at the moment it is chosen.** A vault locked by the device
  alone has no second way in; the copy says so beside the button, not in a help
  page.
- Locked rows never appear in search results, are never offered as a move
  destination, and are never used for duplicate detection.

## 12. Motion

Four animations exist, each with a physical origin. Every one answers "what does
this help the user understand?":

| Animation        | Where                        | What it explains                        |
| ---------------- | ---------------------------- | --------------------------------------- |
| `animate-sheet-in` | sheets open                | the surface rises from the bottom edge  |
| `animate-pop-in`   | dialogs, the boot mark     | it came from where you tapped           |
| `animate-rise`     | toasts                     | a confirmation arrived                  |
| `animate-overlay-in`| scrims                   | the page is now behind the overlay      |

(Two more exist and are not decoration: the locked row's spinner, which explains
that the platform prompt is open, and the boot mark's single pulse.)

Rules:

- Easing is `cubic-bezier(0.32, 0.72, 0, 1)`; durations 160–240ms in, 160–180ms
  out. Nothing overshoots — bounce reads as dated.
- Tap feedback is `tap` + `tap-scale` (a 0.975 press), never hover.
- No page-load animation, no stagger, no ambient motion.
- `prefers-reduced-motion` collapses everything to ~0ms, globally. That rule is
  not optional and must not be scoped away.

---

## 13. Accessibility

- Touch targets: ≥44px (`size-11`, `h-11`, `min-h-11`) for anything a thumb
  presses; icon-only buttons carry `aria-label`.
- Contrast: body text uses `text-fg` or `text-muted`; `text-subtle` is never
  used for something the user must read to act.
- Focus: one visible focus ring (`:focus-visible`, 2px accent, 2px offset).
  No component may remove it.
- Semantics: `nav`/`header`/`main`, `aria-current` on the active tab,
  `aria-pressed` on toggles, real `button` elements for actions.
- Sheets and dialogs get titles and descriptions (Radix wire-up) and trap focus.
- Font scaling: layout is built from rows and truncation, so a larger system
  font grows text without breaking structure. Never set a fixed pixel height on
  a text element.
- Status is never colour alone: a locked link is a lock glyph *and* coloured; a
  dead link is a struck-through icon *and* `danger`.

---

## 14. Empty, loading and error states

- An empty screen says one useful sentence and offers the action that fills it.
  No illustration, no rounded icon tile, no "0 items" statistics.
- Copy is written, not generated: "Nothing waiting to be organized.",
  "Save something worth coming back to.", "Start with a thought."
- Loading is a single quiet pulse (the boot mark). Never a spinner wall, never
  skeleton cards.
- Errors are stated plainly with a next step, in `danger` ink. No codes, no
  "oops".

---

## 15. The signature interaction: capture

`Share sheet → Stash → choose destination → saved` is the most important path in
the product and gets the most care:

- An incoming share takes over the screen — no Home flash first, no app chrome.
- The shared content is shown at the top, then **Inbox**, then recent
  destinations, then the folder tree, then **Create folder**.
- Saving is 1–3 interactions. Inbox is always first and always one tap.
- Confirmation is a toast that also offers Undo where undo is safe.
- After saving, the capture surface returns to a neutral state so the next
  normal launch shows Home, never a stale share.

---

## 16. Checking a change against this document

Before calling UI work done:

1. Remove the borders (mentally): is the hierarchy still legible?
2. Count containers: does each one *say* something a hairline could not?
3. Count radii: more than three shapes on a screen means the vocabulary leaked.
4. Count colours: is every non-neutral colour carrying meaning?
5. Count animations: does each one explain a physical relationship?
6. Read the copy out loud: is it the app talking, or a template?
7. Tab through it, then read it at 200% font scale.
8. Typecheck, lint, test, build (`tsc --noEmit`, `eslint .`, `vitest run`,
   `next build`).

If a screen passes all eight, it belongs in this app.
