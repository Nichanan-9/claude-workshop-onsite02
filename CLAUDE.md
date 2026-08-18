# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This repo is a single self-contained HTML file, `index.html`: a mock restaurant table-booking flow ("โรงเตี๊ยมมังกรทอง" / Golden Dragon Restaurant) themed in a retro Chinese red/white/black/gold style, with Thai-language UI copy. There is no backend, no build step, and no package manager — everything (HTML, CSS via Tailwind CDN, and JS) lives in this one file.

## Coding style

- Indent with 2 spaces; end JS statements with semicolons; use single quotes for JS strings and backtick template literals for any string built from `${}` interpolation or spanning multiple lines (HTML fragments, `formatDate`).
- Naming: `camelCase` for functions, variables, and DOM element IDs; `UPPER_SNAKE_CASE` for top-level constant tables/config (`THAI_DAYS`, `TIME_SLOTS`, `DAYS_AHEAD`, `STEP_LABELS`).
- Group related functions under a `// ---------- Section Name ----------` banner comment (see `state`, `Step indicator`, `Step 1: Dates`, `Submit`, `Reset`, `Init` in the script block); add a new banner for a genuinely new section rather than folding unrelated logic into an existing one.
- Don't write comments that restate what a line does. Only comment a non-obvious constraint or workaround, the way `seededFull`'s comment explains *why* it's a hash instead of `Math.random()`.
- Render functions (`renderDates`, `renderTimes`, `renderStepIndicator`, `renderSummary`, etc.) rebuild their target element's `innerHTML` from `state` wholesale — don't introduce incremental/diffed DOM updates for a single element type while others stay wholesale, and don't add a new field to `state` without a render path that reflects it.
- Keep label/value pairs shown in more than one place (step 3 summary, step 4 success screen) flowing through one function like `summaryRows()` — never duplicate a row list inline at a second call site.
- Styling is Tailwind-utility-first. Only add to the plain `<style>` block or `tailwind.config` when the effect genuinely isn't expressible as utility classes (the existing entries — `.bg-cloud-pattern`, `.double-border`, `.step-view`, `.spinner`, keyframes — are the precedent). New theme colors/fonts go in `tailwind.config`, not as one-off hex values in `class` or inline `style` attributes.
- This project intentionally has no backend, build step, or package manager. Don't introduce one (a bundler, npm scripts, a framework import) to solve a styling or state problem — solve it within the single `index.html` file.

## Running / testing

There are no build, lint, or test commands, and none should be added. To view or test changes, open the file directly in a browser:

```
start index.html          # Windows
```

Manual verification checklist — run through this in a browser after every change, and treat the change as incomplete until every applicable item passes:
1. Step 1 → 2 button stays disabled until a date and time slot are both selected.
2. Step 2 blocks advancing on empty name / invalid phone (9–10 digits), and clears those errors once corrected.
3. Step 3 summary reflects exactly what was entered (including the optional note row only when present).
4. Confirming shows the spinner, then the success screen with a generated booking ID, then "จองโต๊ะใหม่อีกครั้ง" fully resets state back to step 1 (re-check step 1 button is disabled again).
5. Check responsiveness at mobile width and confirm no console errors in DevTools.

If a change adds new state, a new input, or a new branch of behavior, add a corresponding numbered item to this checklist in the same edit — the checklist must stay a complete description of what "working" means for the current feature set.

## Architecture

Everything is driven by a single mutable `state` object in the inline `<script>` block (`dateIndex`, `timeSlot`, `guests`, `name`, `phone`, `note`, `bookingId`). There is no framework — the UI is four `<section class="step-view">` blocks (`#step1`–`#step4`) toggled via `.active` by `goToStep(n)`, which also re-renders the step indicator (`renderStepIndicator`) and, on step 3, the booking summary (`renderSummary`).

Key render functions re-generate their DOM subtree from `state` on every relevant change rather than doing incremental updates:
- `renderDates()` / `selectDate()` — date picker grid (next 10 days from `new Date()`)
- `renderTimes()` / `selectTime()` — time slot grid; a slot's "full" (disabled) status is derived deterministically from `seededFull(dateIndex, slotIndex)` (a small hash, not `Math.random()`), so the same date always shows the same full slots across re-renders
- `changeGuests()` — simple stepper bound to `state.guests` (clamped 1–12)
- `summaryRows()` — single source of truth for the label/value pairs shown in both the step 3 summary and the final success screen, so the two never drift apart
- `submitBooking()` — the only place with a fake async delay (`setTimeout`), simulating a network call before generating a mock booking ID (`generateBookingId()`, format `CN-XXXXXX`) and moving to step 4
- `resetBooking()` — must reset both `state` and every corresponding input element/error message, since form inputs are read directly via `document.getElementById(...).value` rather than being kept in sync with `state` reactively

All strings are Thai (dates formatted via `formatDate()` using a hardcoded Thai day/month name table and Buddhist Era year `+543`). Chinese characters (金, 龍, 訂, 福) are purely decorative accents via the `Ma Shan Zheng` font and are not functional content — see conversation history for what each one means if changing them.

Styling: Tailwind is loaded from the CDN and configured inline via `tailwind.config` in a `<script>` tag (custom `ink`/`lucky-red`/`deep-red`/`gold`/`gold-light`/`cream` colors, `thai`/`chinese` font families). A handful of things aren't expressible in Tailwind utilities and live in a plain `<style>` block instead: the dotted background texture (`.bg-cloud-pattern`), the gold double-border card effect (`.double-border`), step-view show/hide + fade-in animation (`.step-view`), and the loading spinner (`.spinner`).
