# Filename Tokens & Prefer Full Resolution — Design

Date: 2026-07-11
Status: Approved

Two low-bloat features for Image Download - Batch. No new permissions, no new
dependencies. All UI/toggle logic stays out of the minified `popup.js`; exactly
one surgical, localized edit lands in minified `background.js`.

## Feature 1 — Filename tokens

The final download filename is computed in `background.js`'s
`chrome.downloads.onDeterminingFilename` listener. It already resolves
`saveFileAs:"CUSTOM_NAME"` + `saveFileName` into `"{saveFileName}.{ext}"`, and it
already has the download URL, the original base name, the extension, and the
`?index=N` URL parameter the popup appends. The popup already sends whatever the
user types in the custom-name field as `saveFileName`.

### Behavior
- When `saveFileName` contains a `{`, it is treated as a **template** and resolved
  through a new pure function `applyFilenameTokens(template, ctx)`.
- Supported tokens (v1, all resolvable in the SW context — no image metadata):
  - `{name}` — original base filename (no extension)
  - `{index}` — 1-based index from the `?index=` URL param
  - `{ext}` — file extension (without dot)
  - `{domain}` — hostname of the source URL
  - `{date}` — `YYYY-MM-DD`
  - `{time}` — `HH-MM-SS`
- Unknown tokens are left literal. Templates that omit `{index}` and download many
  files rely on Chrome's existing `uniquify` conflict action (`(1)`, `(2)`, ...).
- The resolved value is sanitized for filesystem safety (reuse existing sanitize
  behavior / strip path separators per segment) and the `.{ext}` is appended.

### Scope boundary
- Applies to **individual downloads**. ZIP entry names are built inside minified
  `popup.js` and are out of scope for v1.
- No `{width}/{height}/{alt}` — those require threading per-image metadata through
  minified `popup.js`.

### Components
- **`filenameTokens.js`** (new, unminified) — pure `applyFilenameTokens`; exposed as
  `globalThis.applyFilenameTokens`; unit-tested in Node.
- **`bg-entry.js`** — add `importScripts('filenameTokens.js')` before
  `importScripts('background.js')`.
- **`background.js`** — one surgical edit in the `CUSTOM_NAME` branch: if the name
  contains `{` and `globalThis.applyFilenameTokens` exists, resolve tokens.
- **`popup.html`** — small inline tokens help hint next to the existing custom-name
  field. New localization keys (English + graceful fallback for other locales).

## Feature 2 — Prefer full resolution ("grab largest")

### Behavior
- New pure function `upgradeToLargest(urls)` applied inside the scrapers:
  - Strip known downscale query params: `w, h, width, height, fit, crop, quality,
    q, dpr, resize, size`.
  - Rewrite common thumbnail path patterns: `/thumb/`, `/thumbs/`, `/small/`,
    WordPress `-<W>x<H>` suffix before the extension.
  - Collapse same-image size variants (same normalized key) to a single largest
    entry, preferring the param-stripped / highest indicated size.
  - Never touch `data:` URIs; never drop a URL that has no larger sibling.
- Gated by preference `imgdl_preferFullRes` in `chrome.storage.local`.
  Default **off** ⇒ current behavior is byte-for-byte unchanged.
- It is a URL heuristic (indicated sizes), not pixel-verified — hence default-off
  and clearly labeled in the UI.

### Components
- **`imageScraper.js`** (main, unminified) — add the pure `upgradeToLargest`; read
  `imgdl_preferFullRes` from `chrome.storage.local` and, when on, pass the unique
  URL list through it. The injected script returns a promise; MV3 `executeScript`
  awaits the thenable result.
- **`imageScraperWithScroll.js`** is the minified regenerator variant whose results
  flow via `sendMessage`, not an `executeScript` return. Editing it cleanly is not
  low-risk, and it is a secondary "scroll to load more" path — **deferred to a
  follow-up**. v1 applies the toggle to the main scraper only.
- **`popup.html`** — new "Prefer full resolution" checkbox.
- **`popup-bridge.js`** (unminified, already runs in the popup) — wire the checkbox:
  read/write `imgdl_preferFullRes` directly to `chrome.storage.local`,
  independent of `popup.js`'s preference machinery.

## Testing
- `applyFilenameTokens` and `upgradeToLargest` are pure → Node unit tests
  (token expansion, missing/unknown tokens, sanitization; param strip, path
  rewrite, variant collapse, data-URI safety, no-op when nothing to upgrade).
- Manual Chrome verification: a templated individual download; the toggle changing
  scan results end-to-end.

## Net footprint
- New files: `filenameTokens.js`, unit tests (kept outside the shipped package).
- Edited: `bg-entry.js`, `background.js` (one line), `imageScraper.js`,
  `popup.html`, `popup-bridge.js`, `_locales/en`.
- Deferred: `imageScraperWithScroll.js` (minified scroll variant).
- No new permissions, no new dependencies.

---

## Follow-up batch (2026-07-11)

Three incremental features, same low-risk seams.

### A. More discovery sources (`imageScraper.js`)
Added to `getImages`: `<video poster>` (absolutized), and image-bearing `<link>`
tags — `preload as=image`, `image_src`, `icon`/`shortcut icon`, `apple-touch-icon`
(+`-precomposed`), `mask-icon`. Each guarded with try/catch. No new permission.

### B. Richer filename tokens (`filenameTokens.js`)
Added `{year} {month} {day} {timestamp}` (epoch seconds) `{host}` (alias of
`{domain}`), and zero-padded `{index:N}` (e.g. `{index:3}` -> `001`). Unit tests
extended (21 total). No new permission.

### C. Context menu — "Download all images on this page" (`contextMenu.js`)
New unminified module `importScripts`-ed by `bg-entry.js`. Registers a page/frame/
image/link/video context-menu item; on click injects the existing scraper
(all frames, honoring the prefer-full-res flag), flattens + dedupes results
(pure `flattenDedupeImages`, unit-tested), and downloads every image via
`chrome.downloads.download`. Adds the **`contextMenus`** permission (changes the
install prompt / may trigger CWS re-consent). Menu title localized via
`downloadAllImagesMenu`.

Net batch-2 footprint: new files `contextMenu.js` + 1 test; edited
`imageScraper.js`, `filenameTokens.js`, `bg-entry.js`, `manifest.json`
(+`contextMenus`), `popup.html` (token hint), `_locales/en`.

---

## Batch 3 (2026-07-11)

- **Copy / export image URLs** — toolbar button copies selected (or all) card
  URLs (`.imgContainer[.imgSelected]` `imgsrc`) to the clipboard as a plain list
  with toast feedback; `E` exports `image-urls.txt`. Clipboard API + execCommand
  fallback. Pure `dedupeUrls` unit-tested.
- **In-popup keyboard shortcuts** — Cmd/Ctrl+A select-all, `C` copy, `E` export;
  ignored while typing in a field.
- All in unminified `popup-bridge.js` + one button in `popup.html`. No new permissions.

## Batch 4 (2026-07-11)

- **Smarter full-resolution upgrades** (`upgradeToLargest`, unit tests -> 24):
  Cloudinary transform-segment strip (`/upload/w_300,.../` -> `/upload/`, guarded
  by a digit so real folders/public-ids survive), Shopify-style `_WxH` suffix
  (WP regex generalized to `[-_]`), and a wider downscale query-param set
  (maxwidth/maxheight/mw/mh/wid/hei/sz/imwidth/fm/format/auto/ar/g). Retina
  `@2x`/`@3x` deferred (needs size-ranking, not the strip model).
- **More scraper sources** (`imageScraper.js`): `<object data>`/`<embed src>`
  images and SVG `<image>` raster hrefs (incl. xlink:href), guarded.
- No new permissions.

## Batch 5 (2026-07-11)

- **Retina @Nx preference** (`upgradeToLargest`, unit tests -> 30): variants are
  now grouped by a key that also strips `@Nx`, and within each group the
  highest-density candidate wins (so `photo.jpg` + `photo@2x.jpg` collapse to
  `photo@2x.jpg`, and `@3x` beats `@2x`). Downscale params on a retina URL are
  still stripped while the `@Nx` is preserved. No new permissions.
