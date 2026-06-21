# CLAUDE.md — Izakaya Menu Translator

## Project
Self-use, client-side PWA for iPhone that photographs a Japanese menu (often
handwritten; may be printed, on a blackboard, or on a wall) and translates it.
Three features: category-grouped translation, tap-to-locate highlight on the
original image, and on-demand dish explanations.

## Source of truth
The full build spec is `izakaya-translator-spec.md` at repo root. Read it before
implementing and treat it as authoritative. If anything here conflicts with the
spec, stop and ask.

## Hard constraints
- Single `index.html` (inline HTML/CSS/JS) + `manifest.json` + icons.
  No framework, no build step, no bundler.
- No external JS libraries unless strictly necessary (justify before adding).
- No backend. The browser calls the Gemini REST API directly.
- Gemini API key is entered by the user at runtime and stored in `localStorage`.
  NEVER hardcode a key. NEVER commit a key. No secret may enter the repo.
- All user-facing UI text and all translation/explanation output MUST be
  Traditional Chinese (Taiwan usage). No Simplified Chinese, no mainland/HK terms.

## Tech notes
- Vanilla JS. Keep everything in `index.html` for v1.
- Default model constant `FLASH_MODEL = "gemini-2.5-flash"` (free, vision + spatial).
  NOTE: gemini-3.5-flash was tried but its free-tier quota is near-zero (immediate
  429), so 2.5-flash is the default for free self-use. Thinking params differ by
  family: 2.5 uses thinkingBudget (int), 3.x uses thinkingLevel — see flashThinking().
- `PRO_MODEL = "gemini-3.1-pro-preview"` for manual high-accuracy retry only; confirm
  the current Pro model id against Google docs at build time (names change).
- Structured output via response_mime_type + response_schema (spec §5).
- Normalize image EXIF orientation and downscale before sending; send and display
  the SAME normalized image so box_2d coordinates align (spec §4).

## Workflow (mandatory)
- Do NOT write or modify code until I approve a plan. First reply must be:
  (1) understanding summary, (2) file list, (3) step-by-step plan per spec §14.
  Then wait for my "OK".
- Implement in spec §14 order, one stage at a time; pause for my review after each.
- If the spec is contradictory or infeasible, raise it; do not silently assume.
- Keep commits small and scoped; imperative commit messages.

## Out of scope (v1)
Service Worker / offline, multi-device sync, multi-language (JP -> zh-TW only),
pixel-perfect bounding boxes, accounts/login, and ANY automatic model switching
(model upgrade is manual via a Pro retry button only).
