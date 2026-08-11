# Trip Board — UI consistency audit

The checklist behind Phase 6.3. Phase 6 is a **cross-cutting pass over existing
surfaces, not new features**: the flagship bar was set in Phase 3.5, and 6.3
raises everything else to it.

Scope is `apps/web-board` — the winner of the Phase-3.5 design gate. `web-deck`
and `web-feed` are frozen "alternatives explored" and deliberately excluded.

Re-run this checklist whenever a new surface lands.

---

## 1. The theme is a token contract

The Phase-3.5 palette (warm sand + travel teal) is now **committed** — it is the
board's identity and what the three README screenshots show. It is expressed as
tokens in `src/index.css`, in four groups:

| Group    | Tokens                                                                     |
| -------- | -------------------------------------------------------------------------- |
| surfaces | `--board-bg`, `--lane-bg`, `--board-dot`                                   |
| ink      | `--board-fg`, `--board-dim`                                                |
| line     | `--lane-line`                                                              |
| intent   | `--board-accent`/`--board-on-accent`, `--board-danger`/`--board-on-danger` |
| depth    | `--board-shadow`, `--board-scrim`                                          |

- [x] **No hardcoded colours in components.** Every `.tsx` is free of hex/`rgb()`
      literals; colour lives only in `index.css`.
- [x] **Every `var(--…)` resolves.** Three dead tokens were being read before
      6.3 — `--board-muted`, `--board-line` (the sign-in "or" divider rendered
      _invisible_ rules), and `--board-ink` (a chat-tab hover that did nothing).
      Only `--avatar-hue` and `--r` are intentionally undefined in CSS: both are
      set inline from JS and both are read with a fallback.
- [x] **Foreground/background pairs clear WCAG AA in both themes.** `#fff` on
      `--board-danger` was failing in dark, where danger is a light red — hence
      `--board-on-danger`. The one remaining literal `#fff` sits on a
      fixed-lightness generated avatar, which is dark in both themes.
- [x] **Depth is tokenised.** A dark shadow is invisible on a dark surface, so
      `--board-shadow` supplies the RGB channels and dark mode swaps them.
      The modal scrim was a leftover purple from the pre-3.5 palette.

## 2. Dark mode is correct

The manual toggle (`:root[data-theme]`, Phase 3.5) **overrides** the OS
preference, so both must be handled — and any rule keyed only to
`prefers-color-scheme` is a bug on a manually-toggled board.

- [x] Dark values are declared for **both** selectors — the OS one
      (`:root:not([data-theme])` under a dark media query) and the manual
      `:root[data-theme="dark"]` — as one shared declaration list, so the two
      cannot drift.
- [x] **No component rule keyed to `prefers-color-scheme` for colour.** The
      decorative backdrop's opacity was; it now reads `--board-decor-opacity`,
      so a manually-darkened board gets the dark value.
- [x] `prefers-reduced-motion` still drops the tile lift, the skeleton shimmer,
      the live-dot pulse and the switch transition.

## 3. Four states, every surface

Loading / empty / error / populated. An error state must **say what failed** and
**offer a way out** — a muted sentence with no retry is not an error state.
Likewise an empty state must **name the next action**, or say why there isn't
one for this viewer (Phase 6.4).

| Surface             | Loading  | Empty              | Error             | Populated |
| ------------------- | -------- | ------------------ | ----------------- | --------- |
| Boards overview     | skeleton | onboarding + CTA   | alert + Retry     | tiles     |
| Trip detail (trip)  | ✓        | n/a                | alert + Back      | ✓         |
| Trip detail (lanes) | ✓        | n/a                | alert + Try again | canvas    |
| Categories/options  | ✓        | propose CTA        | inherits lanes    | cards     |
| Cost strip          | ✓        | "Price an option…" | alert             | bars      |
| Chat                | ✓        | "say hello"        | alert + Try again | ✓         |
| Members             | ✓        | n/a                | alert + Try again | list      |
| Invites             | ✓        | ✓                  | alert + Try again | list      |
| Notifications       | ✓        | ✓                  | ✓                 | list      |
| Settings            | ✓        | n/a                | alert + Try again | panels    |
| Activity feed       | ✓        | ✓                  | alert + Try again | feed      |
| Crew panel          | ✓        | n/a                | alert + Try again | list      |

- [x] The trip-lanes error was the worst gap: a muted line with no retry, on the
      one query whose failure empties the whole screen. Now `role="alert"` with
      a **Try again**.
- [x] Retries added to the crew, invite and chat error states, which announced
      the failure but stranded you. Chat's history load had no reload path at
      all, so `useChat` gained a `reload()`.
- [x] Loading text that replaces content is announced (`role="status"`).
- [x] The cost strip's error has no retry button: it sits inside the board,
      which re-queries on the surrounding refetch, and it never occupies the
      whole screen.
- [x] **A limit reached is a state too** (polish pass). At the policy-layer
      category cap the trailing "＋ Add category" tile states the limit instead of
      opening a form the server would 403 — the same rule as the empty states
      below, applied to a _full_ surface rather than an empty one.
- [x] **An empty state never offers an action the server would refuse.** The
      new-user dashboard hid a real break: creating a trip needs a verified
      email but signing in does not, so a just-registered account got the
      full-strength "Create your first trip" CTA and a 403 on submit. Empty
      lanes apply the same rule for Guests and ended boards.

## 4. A11y floor

- [x] **One modal implementation.** All nine dialogs render through
      `components/Dialog.tsx`. Previously each hand-rolled its own backdrop,
      `aria-modal` and Escape listener, and **none trapped focus** — so
      `aria-modal="true"` was a false promise: Tab walked straight out into the
      page a screen reader had been told was inert.
- [x] **Focus is trapped** inside an open dialog; Tab and Shift+Tab cycle.
- [x] **Focus is restored** to whatever opened the dialog when it closes —
      unless the action navigated away, which claims focus deliberately.
- [x] **Initial focus** lands on the first control (or an opt-in target).
- [x] **Dialogs are named by their visible heading** via `aria-labelledby`, not
      a duplicated `aria-label` that can drift from the title on screen.
- [x] **Escape closes** every dialog and popover; a popover inside a dialog
      stops its own Escape, so the inner layer closes first.
- [x] **Backdrop clicks never dismiss** — deliberate and board-wide: these hold
      half-typed forms.
- [x] **Popovers restore focus to their trigger** (`Menu`, `NotificationBell`).
- [x] Visible `:focus-visible` ring on every interactive control.
- [x] Every control has an accessible name; icon-only buttons carry
      `aria-label`, decorative glyphs and the backdrop are `aria-hidden`.
- [x] **No half-implemented ARIA widgets** (polish pass). The chat channel
      switcher advertised `role="tablist"`/`role="tab"` while handling no arrow
      keys and owning no `tabpanel` — a promise to a screen-reader user that the
      row never kept. It is now a `role="group"` of `aria-pressed` toggles, the
      same call `Menu` documents for not pretending to be an ARIA menu.
- [x] **Truncated text is never lost text.** The board shortens category, option
      and channel names to 15 characters in compact positions; every one of those
      carries the full value on `title`, and the accessible name (heading
      `aria-label`, button `aria-label`) stays unabbreviated — a screen reader is
      never read an ellipsis. The option detail dialog shows names in full.
- [x] Drag-and-drop is progressive enhancement — every gesture has a
      keyboard/menu equivalent. Locking can be a drop onto the lane's decide
      strip or "Move to Decided" on the card's "⋯"; **unlocking is the menu
      only**, since the drag-out gesture belonged to the Decided rail and went
      with it. Nothing became unreachable — that menu item was always there.
- [x] **A surface that behaves differently looks different** (polish pass).
      Decided was a `.lane` — identical width, card shape and chrome to a
      category, distinguished only by a dashed border — pinned first in the
      lane row. It read as a category and it was not one. It became a rail
      above them, and then it was **removed entirely**: once a decision also
      stayed pinned in the lane that made it, the rail was a second copy of
      every decision directly above the first. The summary band now carries the
      cost and the crew — the two things the lanes below cannot tell you by
      being read.
- [x] **Colour is never the only signal** (category colour pass). Each category
      wears a hue and an icon across its lane, its cards and the timeline; the
      category's name is rendered beside every one of them, and the hue only
      tints surfaces and edges. Tinted text (the category pills) is held to
      4.5:1 by pinning lightness per theme to the worst hue in the ring.
- [x] Touch targets ≥44px on the primary controls at phone width.

## Known limits

- Contrast pairs were chosen against the token values and spot-checked, not
  machine-verified in CI. An automated axe pass over the built app is a
  reasonable Phase-7 addition.
- jsdom does no layout, so the tests assert focus **order and restoration**, not
  that a focused control is visually in view.
- Per project convention there are **no screenshot/visual-regression tests**;
  the owner reviews the rendered UI directly.
