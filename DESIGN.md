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

**Paper and ink: a warm, quiet drawer of things worth keeping.**

Stash is a private utility someone opens many times a day to file something or
find something. It is not a dashboard, not a social product, not a showcase. It
should feel like a well-made notebook that is *pleased* to be used: warm paper,
warm ink, generous type, everything in its place.

Four rules produce everything else:

1. **Warm neutrals, never blue-grey.** Every neutral in the palette carries a
   little amber. Cool grey is what makes an interface read as a developer tool;
   the same layout in warm paper reads as an object someone chose.
2. **Hierarchy is typographic.** Size, weight, position and space carry it. A
   screen with its containers removed must still be understandable.
3. **Group, do not rule.** Things that belong together sit on one soft card with
   hairlines inside it. Full-bleed rules across a screen are a spreadsheet.
4. **Colour is a signal.** One accent for the primary action and the current
   selection; semantic colours only where meaning demands them.

Corollary: **design from content, not from components.** Start with "what does
the user need to know here", not "I need a Card". A folder is a name, a count
and a way in — that is a row, not a tile.

### The mark

**A kept ribbon:** a bookmark whose notch is a soft curve rather than a sharp V,
in cream on a deep pine tile (`brand_cream` on `brand_ink`). It says what the app
is for — things you mean to keep — and it is one flat shape, so it reads at 16px
in a tab bar and at 192px on a home screen with no second colour, no gradient and
no shadow.

Rules:

- **There is one mark.** It appears on the launch screen, in the settings
  sign-off, on an empty Home, and as the app icon. Nowhere else — a logo in a page
  header is decoration, and the app already has a title.
- **It is drawn, not imported.** `src/components/ui/logo.tsx` renders it from the
  same path as the icons, in `currentColor`, so it is crisp at any size and
  follows the theme without a second asset. Do not add a PNG of the mark to the
  interface.
- **Icon assets are generated.** `public/icons/{icon,maskable,foreground}.svg`
  are the masters; `node scripts/make-icons.mjs` writes every PNG (favicon,
  apple-touch, PWA, Android launcher and adaptive foreground). Never hand-edit a
  generated PNG — edit the master and re-run the script.
- **The tile is the same in both themes.** The app icon is shown next to other
  apps, not inside Stash, so it does not follow the theme. `--brand-ink` and
  `--brand-cream` exist for that reason and are the only fixed colours in the
  system.

---

## 2. Forbidden patterns

These are the specific tells of generated UI. None of them are in the app, and
none of them may be added:

- gradient hero cards, gradient buttons, gradient text, "AI purple/blue" palettes;
- glassmorphism, glowing borders, floating blobs, decorative sparkles;
- a container around every element: card-inside-card, a box per list row, a
  rounded tile behind every icon. (A tile behind an *entity's own icon* is the one
  exception and it is already spent: folders. Links and notes are content and
  stay bare — a rounded square with an initial in it is the most recognisable
  generated-UI flourish there is.)
- `rounded-2xl` on everything (see §5 — shape is a vocabulary);
- random icon colours, or an icon on every label "for balance";
- **hairline rules across a full screen**, and `border-dashed` anything: a dashed
  outline is what a design tool draws for "something goes here";
- headings that push content below the fold. (A 28px page title on a phone is
  not oversized — it is the difference between an app and a form. A hero band or
  an illustration above it is.)
- bordered pill chips for every metadata value. Soft chips (`bg-surface-2`,
  `rounded-full`, no outline) are allowed for a wrapped set of short names, which
  is the one shape that works for "favourite folders" and tags;
- badge soup, stat tiles, dashboards, scores;
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
| `text-display`| 28px | the page title — one per screen                |
| `text-title`  | 19px | sheet and dialog titles, the wordmark          |
| `text-row`    | 16px | list-item titles (the most common text)        |
| `text-body`   | 15px | prose the user reads or writes                 |
| `text-meta`   | 13.5px | the secondary line under a row title         |
| `text-label`  | 13px | section labels                                 |

Rules:

- **Nothing is smaller than 13px, and nothing important is smaller than 15px.**
  A phone's type is not a desktop's: text that is legible on a 27" display is a
  squint in daylight on a bus.
- Weight does the emphasis: `font-semibold` for titles and section labels,
  `font-medium` for row titles, regular for prose. Avoid bold-everywhere.
- Section labels are sentence case, no letter-spacing, `font-semibold`,
  `text-muted` — *not* `text-subtle`. A signpost has to be readable; that was the
  bug in the old scale, where labels looked like something to skip.
- Two weights of secondary ink: `text-muted` for content the user reads,
  `text-subtle` for metadata that is never load-bearing. Do not stack three greys
  in one row.
- **Every text colour clears 4.5:1 against every surface it can sit on**, in both
  themes — including `text-subtle`. Re-check with the pair table when a palette
  value changes; "metadata" is not a licence to be unreadable.
- Truncate, never wrap, in rows. A row is one line of title plus one line of
  metadata, full stop.

---

## 4. Spacing and density

- 4px base unit. In practice: `px-4` page gutter, `py-3.5` row padding, `gap-3`
  inside a row, `mt-8` between sections, `pb-2` under a section label.
- **Rows are comfortable, not crammed**: a row with two lines of text is ~70px,
  which is a 44px touch target with air around it. The old density fitted more
  links per screen and made the app feel like a table; scrolling one extra screen
  is a fair price for a list that is pleasant to read.
- One gutter everywhere (16px), so lists line up from screen to screen. Cards are
  inset by exactly that gutter (`mx-4`), so a card's edge is never confused with
  the screen's edge.
- A row is: title line, optional metadata line, optional trailing controls.
  Nothing else.

---

## 5. Shape

Radius is a vocabulary with four words, not a default:

| Token                  | Use                                                     |
| ---------------------- | ------------------------------------------------------- |
| `rounded-tap`   (10px) | controls *inside* content (a small inline button)        |
| `rounded-control`(14px)| a real button, a field, an icon tile                     |
| `rounded-2xl`  (20px)  | a group of rows — use the `card` utility, not the class  |
| `rounded-surface` (28px)| a sheet or a dialog that floats above the page          |

A list is a `card`: one soft edge around rows that belong together, with
hairlines *inside* it. The first and last row are clipped by the radius, which is
why `card` sets `overflow-hidden`.

`rounded-full` is reserved for: the floating action button, the sheet grab
handle, circular icon buttons in a row (`size-10`), the active tab's icon capsule,
and soft chips. That is the whole list.

Generous radii are not decoration. A 20px corner and a 44px button are what make
an interface feel touchable rather than drawn — and touchability is most of what
"friendly" means.

---

## 6. Colour and surface

One accent — **deep pine** (`#0b6b58` light, `#5dcbaf` dark) — used for: the
primary action, the current selection, links-in-context, focus, and nothing else.
Away from that: warm neutral.

Surfaces, in a deliberately small ladder (light → dark):

- `bg` — the paper (`#faf8f4` / `#151714`). What most of the screen is.
- `surface` — chrome raised off the paper: cards, sheets, bars, toasts.
- `surface-2` — an inset: a field, an icon tile, a chip, a pressed row.
- `surface-3` — one step further in, for pressed states of insets.

The two brand colours (`brand_ink` `#182a24`, `brand_cream` `#f6f1e7`) are fixed
in both themes: they belong to the icon, which is not inside the app.

Semantic colours are used only when they mean something: `danger` for
destructive actions and a link the user marked dead; `warning` for a favourite
star; `success` for a confirmation toast. Never for variety.

Dark mode is not inverted light mode and is never `#000`. Surfaces step
`#151714 → #1d1f1b → #252721 → #30322b`, so depth reads as material rather than
as holes, and the paper stays warm. Text tops out just below pure white, and the
accent lightens rather than darkens: a deep pine becomes invisible against a dark
background, so dark mode uses mint.

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

**No native chrome, ever.** The window belongs to the app and the app draws all
of it. Three rules, because each of them has already been broken once and each
failure looks the same on a phone — a bar at the top that nobody designed:

- **Both themes are no-action-bar themes, and the theme is claimed before any
  other window work** (`setTheme` first in `MainActivity.onCreate`, before
  `EdgeToEdge.enable`). AppCompat installs an ActionBar — titled with the
  activity label, which is the app's name — from whatever theme is current when
  the window's decor is first inflated, and one installed from the launch theme
  survives the later swap.
- **The window background is a flat colour, never a bitmap**
  (`color/stash_window_background`, day/night variants in
  `android/app/src/main/res/values{-night}/colors.xml`, matching the `bg`
  token). The window background is the one surface CSS cannot paint: it shows
  wherever the WebView does not cover the window — before the first frame, and in
  the strip Capacitor reserves natively on WebViews too old to report their own
  insets. A splash *image* there becomes a band of that image above the app's own
  content. `@drawable/splash` is therefore referenced by no theme.
- **Never set a window title or a toolbar**, and never assume `android:label`
  (used by the share sheet, which should say "Stash") renders inside the app.

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
- **Stash has no lock screen, and asking for a password to open it is a bug.**
  The app opens like any other app; what is locked is *content*. A locked folder
  is simply not readable — its name was never stored — and that is the whole of
  what "locked" looks like on screen. There is no full-screen gate over the app,
  no boot prompt, and no password to get in.
- **Tapping a locked row is what raises the system prompt** — `BiometricPrompt`
  (which offers the phone's PIN/pattern for free) on Android, Windows Hello on a
  PC. It is the app's only prompt, and it appears where the user pointed: on the
  item. The dialog (`lock-gate.tsx`) is a *reveal* prompt, never a gate — it is
  shown when a tap on a locked item did not get answered, which is also the only
  moment a message about a failed or cancelled prompt belongs on screen.
- **An unlock is the session, and the session is the tab.** Passing the prompt
  unlocks *everything* locked, because there is one vault key and one lock state:
  folders the user has not touched open too. It ends on the next tab change and
  the moment the app stops being on screen — which is what "they locked the
  phone" looks like from inside — so there is no timeout to configure and no copy
  may imply the unlock is permanent. The one navigation exempted is the one the
  unlock itself caused (opening the folder that was just unlocked), and it is
  exempted by the grace window in `src/lib/privacy/session.ts`, not by a rule the
  user has to understand.
- **A share is never behind the prompt.** Saving a shared link is an ordinary
  capture into an ordinary folder; it must work with a locked vault and must
  never open, or wait on, an unlock.
- **There is exactly one way in, and no passcode.** Stash keeps no passcode of
  its own — no setup screen offers one, no settings row adds or changes one, and
  no copy may imply one exists. The system prompt is the gate the device already
  trusts, and someone who cannot pass it does not read the locked items; that is
  the design, not a gap in it. The one exception is a vault created by an older
  build, whose key is wrapped by a passcode and by nothing else: its gate shows a
  passcode field, because that field is the only thing standing between the user
  and permanently unreadable content. Nothing writes a passcode any more, so the
  copy must speak about it in the past tense ("the passcode this vault was
  created with").
- **Name the platform dialog.** "Windows Hello or your device PIN" on a PC,
  "your fingerprint, face or phone PIN" on a phone. Never "biometrics".
- **Say what it costs, at the moment it is chosen.** A vault locked by the device
  alone has no second way in and no reset, and a backup of it carries no key:
  the copy says so beside the button, not in a help page. Two consequences are
  stated wherever they bite — clearing the app's data or losing the device makes
  locked items unreadable forever, and a backup written by such a vault can only
  open its locked items on the device that wrote it.
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
