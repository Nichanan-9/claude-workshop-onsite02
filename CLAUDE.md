# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This repo is a single self-contained HTML file, `index.html`: a mock restaurant table-booking flow ("โรงเตี๊ยมมังกรทอง" / Golden Dragon Restaurant) themed in a retro Chinese red/white/black/gold style, with Thai-language UI copy. There is no backend, no build step, and no package manager — everything (HTML, CSS via Tailwind CDN, and JS) lives in this one file.

## Running / testing

There are no build, lint, or test commands. To view or test changes, open the file directly in a browser:

```
start index.html          # Windows
```

Manual verification checklist after changes:
1. Step 1 → 2 button stays disabled until a date and time slot are both selected.
2. Step 2 blocks advancing on empty name / invalid phone (9–10 digits), and clears those errors once corrected.
3. Step 3 summary reflects exactly what was entered (including the optional note row only when present).
4. Confirming shows the spinner, then the success screen with a generated booking ID, then "จองโต๊ะใหม่อีกครั้ง" fully resets state back to step 1 (re-check step 1 button is disabled again).
5. Check responsiveness at mobile width and confirm no console errors in DevTools.

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
