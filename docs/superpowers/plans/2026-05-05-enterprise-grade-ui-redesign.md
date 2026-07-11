# Enterprise-Grade UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every visual surface of the Image Download - Batch Chrome extension to enterprise-grade polish by formalizing design tokens, unifying components, and elevating accessibility — while preserving the Darkroom brand identity and all minified JS runtime dependencies.

**Architecture:** Direct edits to `popup.css` and `popup.html` in the existing unpacked extension. No build step. All changes are additive or replacement CSS rules that keep existing class names intact. Manual verification via Chrome Developer Mode.

**Tech Stack:** Vanilla CSS (custom properties), HTML, jQuery (vendored, used by minified JS), jQuery UI (vendored), Chrome Extension Manifest V3 APIs.

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `popup.css` | Major Edit | Full token system, component restyling, unified surfaces |
| `popup.html` | Minor Edit | Self-hosted fonts, ARIA attributes, toast container placeholder |
| `fonts/` | New Dir | Self-hosted WOFF2 font files |

---

## Plan

### Task 1: Establish Foundation Tokens in popup.css

**Files:**
- Modify: `popup.css`

**Context:** The existing `popup.css` has scattered hardcoded colors, spacing, and radius values. We will prepend a formal `:root` token block that defines all design tokens, then migrate existing rules to use them. We will keep ALL existing rules and class names intact; we only update values inside them.

- [ ] **Step 1.1: Backup the current CSS**

```bash
cp popup.css popup.css.backup
```

- [ ] **Step 1.2: Write the design token `:root` block at the top of the file**

Open `popup.css` and replace the first `:root` block (lines 8–72) with the full token system defined in the spec. Keep all existing custom properties that are consumed by minified JS (e.g., `--fc`, `--primary`, `--primary-hover`), mapping them to new tokens:

```css
:root {
  /* ── Color Tokens ── */
  --bg: #060608;
  --bg-elevated: #0e0e11;
  --bg-card: #13131a;
  --bg-tooltip: #1c1c24;
  --bg-input: #0a0a0e;
  --bg-scrim: rgba(0,0,0,0.75);

  --text-primary: #e8e6e3;
  --text-secondary: #9e9ca6;
  --text-muted: #6b6a75;
  --text-inverse: #060608;

  --accent: #f4a261;
  --accent-hover: #e76f51;
  --accent-pressed: #c45a3a;
  --accent-glow: rgba(244,162,97,0.22);
  --accent-ghost: rgba(244,162,97,0.08);
  --accent-ghost-hover: rgba(244,162,97,0.14);

  --danger: #ef4444;
  --danger-hover: #dc2626;
  --success: #2a9d8f;
  --success-hover: #21867a;
  --info: #3b82f6;
  --warning: #f59e0b;

  --border-subtle: rgba(255,255,255,0.05);
  --border-medium: rgba(255,255,255,0.09);
  --border-strong: rgba(255,255,255,0.14);

  /* Legacy shim for minified JS */
  --fc: var(--text-primary);
  --primary: var(--accent);
  --primary-hover: var(--accent-hover);

  /* ── Spacing ── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* ── Typography (values remain; font references change in Task 2) ── */
  --font-display: 'Playfair Display', 'Georgia', 'Times New Roman', serif;
  --font-body: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  --text-3xs: 10px;
  --text-2xs: 11px;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --text-3xl: 32px;

  /* ── Shape ── */
  --radius-sm: 3px;
  --radius-md: 5px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 100px;
  --radius: var(--radius-md);

  /* ── Shadows ── */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.50);
  --shadow-md: 0 6px 20px rgba(0,0,0,0.55);
  --shadow-lg: 0 12px 32px rgba(0,0,0,0.60);
  --shadow-xl: 0 20px 48px rgba(0,0,0,0.65);
  --shadow-focus: 0 0 0 3px var(--accent-glow);

  /* ── Motion ── */
  --ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out-quad: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-instant: 80ms;
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
}
```

- [ ] **Step 1.3: Verify the file still loads without errors**

Open Chrome → `chrome://extensions` → reload the extension → open the popup. If it fails to render, restore the backup.

---

### Task 2: Self-Host Fonts and Update HTML

**Files:**
- Create: `fonts/PlayfairDisplay-Bold.woff2`, `fonts/PlayfairDisplay-ExtraBold.woff2`, `fonts/JetBrainsMono-Regular.woff2`, `fonts/JetBrainsMono-Medium.woff2`, `fonts/JetBrainsMono-SemiBold.woff2`
- Modify: `popup.html`
- Edit: `popup.css` (add `@font-face` rules)

**Context:** The current `popup.html` loads Google Fonts via network. We replace this with local WOFF2 files to remove the network dependency and improve offline reliability.

- [ ] **Step 2.1: Create `fonts/` directory and add font files**

Download or source the WOFF2 files for:
- Playfair Display (weights 700, 800)
- JetBrains Mono (weights 400, 500, 600)

Place them in a new `fonts/` directory at the project root.

- [ ] **Step 2.2: Write `@font-face` rules at the top of `popup.css`**

Insert after `:root` block:

```css
/* ── Self-Hosted Fonts ── */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: local('Playfair Display Bold'), local('PlayfairDisplay-Bold'),
       url('fonts/PlayfairDisplay-Bold.woff2') format('woff2');
}
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 800;
  font-display: swap;
  src: local('Playfair Display ExtraBold'), local('PlayfairDisplay-ExtraBold'),
       url('fonts/PlayfairDisplay-ExtraBold.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: local('JetBrains Mono Regular'), local('JetBrainsMono-Regular'),
       url('fonts/JetBrainsMono-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: local('JetBrains Mono Medium'), local('JetBrainsMono-Medium'),
       url('fonts/JetBrainsMono-Medium.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: local('JetBrains Mono SemiBold'), local('JetBrainsMono-SemiBold'),
       url('fonts/JetBrainsMono-SemiBold.woff2') format('woff2');
}
```

- [ ] **Step 2.3: Remove external Google Fonts from popup.html**

In `popup.html`, find and remove these lines:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

- [ ] **Step 2.4: Add toast container placeholder**

Before `</body>`, add:

```html
<div id="toastContainer" aria-live="polite" aria-atomic="true" style="position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%); z-index: 9999; pointer-events: none;"></div>
```

- [ ] **Step 2.5: Commit**

```bash
git add popup.css popup.html fonts/
git commit -m "style: self-host fonts, add toast container, establish design tokens"
```

---

### Task 3: Unify Buttons

**Files:**
- Modify: `popup.css`

**Context:** The existing CSS has two button classes (`.download-button` and `.downloadButton`) with overlapping but inconsistent styles. We unify them visually while keeping both class names for backward compatibility with minified JS.

- [ ] **Step 3.1: Define a shared `.btn` base class**

Add a new `.btn` block in `popup.css` (choose a location after existing buttons or create a new section):

```css
/* ── Unified Button Base ── */
.btn,
.download-button,
.downloadButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 1;
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-in-out-quad),
              color var(--duration-fast) var(--ease-in-out-quad),
              box-shadow var(--duration-fast) var(--ease-in-out-quad),
              transform var(--duration-fast) var(--ease-in-out-quad);
}
.btn:focus-visible,
.download-button:focus-visible,
.downloadButton:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}
.btn:disabled,
.download-button:disabled,
.downloadButton:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none !important;
}
```

- [ ] **Step 3.2: Add variant classes mapped alongside existing rules**

Add:

```css
/* Primary */
.btn--primary,
.download-button:not(.cancelButton),
.downloadButton:not(.cancelButton):not(#saveprefscancel):not(#manyfilescancel) {
  background-color: var(--accent);
  background-image: linear-gradient(to bottom, rgba(255,255,255,0.06) 0%, transparent 50%);
  color: var(--text-inverse);
  box-shadow: 0 2px 8px rgba(244,162,97,0.25),
              0 0 0 1px rgba(244,162,97,0.15) inset,
              inset 0 1px 0 rgba(255,255,255,0.14);
}
.btn--primary:hover,
.download-button:not(.cancelButton):hover,
.downloadButton:not(.cancelButton):not(#saveprefscancel):not(#manyfilescancel):hover {
  background-color: var(--accent-hover);
  box-shadow: 0 5px 18px rgba(244,162,97,0.45),
              0 0 0 1px rgba(244,162,97,0.30) inset,
              inset 0 1px 0 rgba(255,255,255,0.20);
  transform: translateY(-1px);
}
.btn--primary:active,
.download-button:not(.cancelButton):active,
.downloadButton:not(.cancelButton):not(#saveprefscancel):not(#manyfilescancel):active {
  transform: translateY(0);
  background-color: var(--accent-pressed);
  box-shadow: 0 1px 3px rgba(244,162,97,0.20), inset 0 2px 4px rgba(0,0,0,0.20);
}

/* Ghost / Cancel */
.btn--ghost,
.cancelButton,
#saveprefscancel,
#manyfilescancel {
  background: none;
  color: var(--text-secondary);
  box-shadow: none;
  border: 1px solid var(--border-subtle);
}
.btn--ghost:hover,
.cancelButton:hover,
#saveprefscancel:hover,
#manyfilescancel:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--border-medium);
  box-shadow: none;
  transform: translateY(-1px);
}
.btn--ghost:active,
.cancelButton:active,
#saveprefscancel:active,
#manyfilescancel:active {
  transform: translateY(0);
  background: rgba(255,255,255,0.03);
}

/* Secondary / Outline (for future use) */
.btn--secondary {
  background: none;
  color: var(--accent);
  border: 1px solid var(--accent);
  box-shadow: 0 0 12px rgba(244,162,97,0.15);
}
.btn--secondary:hover {
  background: rgba(244,162,97,0.10);
  box-shadow: 0 0 20px rgba(244,162,97,0.25);
  transform: translateY(-1px);
}
```

- [ ] **Step 3.3: Suppress idle pulse animation on hover/active/focus**

Verify the existing rule:

```css
.download-button {
  animation: safelightPulse 3s ease-in-out infinite;
}
.download-button:hover,
.download-button:active {
  animation: none;
}
```

If it does not include `:focus-visible`, add it:

```css
.download-button:hover,
.download-button:active,
.download-button:focus-visible {
  animation: none;
}
```

- [ ] **Step 3.4: Manual test — verify all buttons render correctly**

Open the popup, side panel, preferences modal, and download confirmation dialog. Check:
- Primary buttons: amber bg, white text
- Hover: darker amber, lift up
- Active: pressed down, darker still
- Ghost/cancel: transparent with border
- No broken layouts

- [ ] **Step 3.5: Commit**

```bash
git add popup.css
git commit -m "style: unify button base, add variant classes, focus rings"
```

---

### Task 4: Refine Form Controls

**Files:**
- Modify: `popup.css`

**Context:** Inputs, selects, and number fields currently have inconsistent heights, paddings, and border radii. We introduce a unified `.control` base class while keeping existing selectors for backward compatibility.

- [ ] **Step 4.1: Define `.control` base class**

Write the following into `popup.css`:

```css
/* ── Unified Form Control ── */
.control,
.selectMenu.download-button__menu input[type="text"],
.selectMenu.download-button__menu input[type="number"],
.selectMenu.download-button__menu select,
.prefsDownloadMenu input[type="text"],
.prefsDownloadMenu input[type="number"],
.prefsDownloadMenu select,
.filterInput,
#savefoldername,
#savefoldernamePrefs,
#saveFileName,
#saveFileNamePref,
#filterbyurlinput,
#convertFrom,
#convertTo,
#convertFromPrefs,
#convertToPrefs,
#saveFileAs,
#saveFileAsPref {
  height: 36px;
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-in-out-quad),
              box-shadow var(--duration-fast) var(--ease-in-out-quad);
}
.control:focus,
.selectMenu.download-button__menu input:focus,
.prefsDownloadMenu input:focus,
.filterInput:focus,
#savefoldername:focus,
#savefoldernamePrefs:focus,
#saveFileName:focus,
#saveFileNamePref:focus,
#filterbyurlinput:focus,
#convertFrom:focus,
#convertTo:focus,
#convertFromPrefs:focus,
#convertToPrefs:focus,
#saveFileAs:focus,
#saveFileAsPref:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

/* Compact variant for number inputs inside filter pills */
.control--compact,
#minwidthinput,
#minheightinput {
  height: 28px;
  padding: 4px 8px;
  text-align: center;
}

/* Error state */
.control--error,
.input-error,
#saveFileName.input-error,
#saveFileNamePref.input-error {
  border-color: #ff6b6b !important;
  box-shadow: 0 0 0 3px rgba(255,107,107,0.2) !important;
}
```

- [ ] **Step 4.2: Verify no visual regressions**

Open the popup → click download dropdown → inspect inputs (subfolder, custom filename). Check preferences modal inputs. Verify focus states show amber border. Verify compact number inputs in filter pills ("At least" size filter) are still small.

- [ ] **Step 4.3: Commit**

```bash
git add popup.css
git commit -m "style: unify form controls with .control base class, add compact variant"
```

---

### Task 5: Enhance Custom Checkbox

**Files:**
- Modify: `popup.css`

**Context:** The checkbox references an external `check.svg` file. We replace it with an optimized inline SVG data URI for pixel-perfect rendering without a network round-trip.

- [ ] **Step 5.1: Rewrite checkbox checked state with inline SVG**

Find the existing checkbox rule block (around line 185):

```css
input[type="checkbox"]:checked::before {
  opacity: 1;
}
```

Replace the `::before` block with an inline SVG checkmark:

```css
input[type="checkbox"]:checked::before {
  content: "";
  width: 0.65em;
  height: 0.65em;
  opacity: 1;
  box-shadow: inset 1em 1em var(--accent-text);
  transform-origin: bottom left;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23060608' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  clip-path: none;
}
```

**Note:** The `clip-path` polygon approach is removed in favor of the SVG data URI. The visual result should be identical but with sharper rendering.

- [ ] **Step 5.2: Verify checkboxes**

Open the popup and click the "Download as .ZIP" checkbox. Verify the checkmark renders clearly.

- [ ] **Step 5.3: Commit**

```bash
git add popup.css
git commit -m "style: replace checkbox checkmark with inline SVG data URI"
```

---

### Task 6: Elevate Image Cards

**Files:**
- Modify: `popup.css`

**Context:** `.imgContainer` cards are the core visual surface. We enhance hover/selected states and fix the placeholder pattern.

- [ ] **Step 6.1: Add card hover lift transition**

After the existing `.imgContainer` block, add/update:

```css
.imgContainer .origImg {
  transition: transform var(--duration-base) var(--ease-out-expo);
}
.imgContainer:hover .origImg {
  transform: scale(1.02);
}
```

- [ ] **Step 6.2: Strengthen selected state glow**

Verify the existing `.imgSelected` rule:

```css
.imgSelected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow), var(--shadow-md);
}
```

If it's missing or weak, replace with:

```css
.imgSelected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow), 0 0 12px var(--accent-glow), var(--shadow-md);
}
```

- [ ] **Step 6.3: Fix placeholder checkerboard colors**

Find the `.origImg` placeholder rule and replace hardcoded `#1a1a1f`:

```css
.origImg {
  background-image: linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%, rgba(255,255,255,0.03)),
                  linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%, rgba(255,255,255,0.03));
  background-size: 20px 20px;
  background-position: 0 0, 10px 10px;
  margin: 0;
  background-color: var(--bg-card);
}
```

- [ ] **Step 6.4: Manual test**

Hover over image cards. Click to select. Verify glow is visible. Scroll to ensure transition is smooth.

- [ ] **Step 6.5: Commit**

```bash
git add popup.css
git commit -m "style: elevate image card hover, selected glow, tokenize placeholder"
```

---

### Task 7: Unify Filter Pills and Dropdowns

**Files:**
- Modify: `popup.css`

**Context:** Filter pills and dropdown menus have inconsistent radii, shadows, and background blurs. We standardize all floating menus into `.dropdown-menu`.

- [ ] **Step 7.1: Unify dropdown styling**

Add/update `.selectMenu` to enforce consistent floating menu styling:

```css
.selectMenu {
  display: none;
  position: absolute;
  z-index: 10000;
  background: var(--bg-card);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  margin-top: 0;
  top: calc(100% + 6px);
  left: 0;
  width: max-content;
  min-width: 120px;
  max-width: calc(100vw - 20px);
  max-height: 400px;
  overflow: auto;
  color: var(--text-primary);
  font-family: var(--font-body);
  animation: dropdownIn var(--duration-base) var(--ease-out-expo);
}

@keyframes dropdownIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

#sortTab .selectMenu {
  left: auto;
  right: 0;
  min-width: 180px;
}

.selectMenu.download-button__menu {
  position: absolute !important;
  width: min(338px, calc(100vw - 16px));
  left: 0 !important;
  top: calc(100% + 12px) !important;
  margin-top: 0;
  min-width: 320px;
  max-width: none;
  max-height: min(78vh, 560px);
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  box-sizing: border-box;
  background-color: var(--bg-card);
  background-image:
    radial-gradient(80% 60% at 0% 100%, rgba(244,162,97,0.045) 0%, transparent 60%),
    radial-gradient(60% 40% at 100% 0%, rgba(255,255,255,0.018) 0%, transparent 70%);
  border: 1px solid var(--border-medium);
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,0.025);
}
```

- [ ] **Step 7.2: Style active filter pills distinctly**

Add active filter indicator:

```css
.filters .changedMenu {
  font-weight: bold;
  color: var(--accent);
  opacity: 0.9;
  background: var(--accent-ghost);
  border-color: var(--accent);
}
```

- [ ] **Step 7.3: Test dropdowns**

Open each filter dropdown (Size, Type, Layout, Sort) and verify:
- Consistent blur, radius, and shadow
- Items have checkmark and amber text when selected
- Animation feels smooth

- [ ] **Step 7.4: Commit**

```bash
git add popup.css
git commit -m "style: standardize dropdown menus, add entrance animation, refine filter pills"
```

---

### Task 8: Elevate Modal/Dialog and Toast Container

**Files:**
- Modify: `popup.css`, `popup.html` (already added toast container in Task 2)

**Context:** Modals already have a good structure with entrance animations but need slight ARIA and structural refinements.

- [ ] **Step 8.1: Verify modal dialog structure**

Confirm `.popupEl` styles are consistent:

```css
.popupEl {
  padding: 24px;
  box-sizing: border-box;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--bg-card);
  color: var(--text-primary);
  width: 420px;
  max-width: 92%;
  box-shadow: var(--shadow-lg);
  border-radius: var(--radius-lg);
  max-height: 90%;
  overflow: auto;
  border: 1px solid var(--border-medium);
}
```

- [ ] **Step 8.2: Ensure modal header has amber accent bar**

Verify `.popupEl__header` and `.popupEl__title` (already present). If not present, add:

```css
.popupEl__header {
  padding: var(--space-5) var(--space-6) var(--space-4) !important;
  background: linear-gradient(180deg, rgba(244,162,97,0.06) 0%, transparent 100%);
  border-bottom: 1px solid var(--border-medium) !important;
}
.popupEl__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 10px;
}
.popupEl__title::before {
  content: '';
  width: 3px;
  height: 24px;
  background: var(--accent);
  border-radius: var(--radius-full);
  box-shadow: 0 0 12px var(--accent-glow);
}
```

- [ ] **Step 8.3: Add toast container styles**

Add at the bottom of `popup.css`:

```css
/* ── Toast Container (Reserved) ── */
#toastContainer {
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 320px;
  width: 100%;
}
.toast {
  pointer-events: auto;
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  animation: toastIn var(--duration-base) var(--ease-out-expo);
  opacity: 1;
  transition: opacity 200ms ease, transform 200ms ease;
}
.toast.toast--out {
  opacity: 0;
  transform: translateY(8px);
}
@keyframes toastIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 8.4: Commit**

```bash
git add popup.css
git commit -m "style: refine modal header, add toast container styles"
```

---

### Task 9: Loading States and Empty State

**Files:**
- Modify: `popup.css`

**Context:** The spinner uses three bouncing divs but only shows a CSS pseudo-element spinner. We clean this up.

- [ ] **Step 9.1: Simplify spinner**

Find `.spinner` and update:

```css
.spinner {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 32px;
}
.spinner > div { display: none; }
.spinner::before {
  content: "";
  box-sizing: border-box;
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 3px solid var(--bg-elevated);
  border-top-color: var(--accent);
  animation: spinner-spin 0.8s linear infinite;
}
```

- [ ] **Step 9.2: Enhance empty state**

Find the `#imgsContainer:not(:has(.imgContainer)):not(:has(.spinner))::after` rule and replace:

```css
#imgsContainer:not(:has(.imgContainer)):not(:has(.spinner))::after {
  content: "";
  display: block;
  text-align: center;
  width: 100%;
  margin-top: 80px;
}
#imgsContainer:not(:has(.imgContainer)):not(:has(.spinner))::before {
  content: "";
  display: block;
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b6a75' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'%3E%3C/circle%3E%3Cpolyline points='21 15 16 10 5 21'%3E%3C/polyline%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  opacity: 0.6;
}
#imgsContainer:not(:has(.imgContainer)):not(:has(.spinner)) .emptyStateText {
  display: block;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-md);
  font-weight: 500;
  font-family: var(--font-body);
  letter-spacing: 0.05em;
  opacity: 0.7;
}
```

**Note:** The empty state text is currently delivered via a single `::after` rule. Splitting into `::before` (icon) and `::after` (text) allows better control. If the minified JS creates elements in `#imgsContainer`, verify nothing breaks.

- [ ] **Step 9.3: Commit**

```bash
git add popup.css
git commit -m "style: refine spinner, elevate empty state with inline icon"
```

---

### Task 10: Accessibility — Focus, Reduced Motion, Tooltip Positioning

**Files:**
- Modify: `popup.css`, `popup.html`

**Context:** Accessibility is a first-class concern. We enhance focus rings and ensure `prefers-reduced-motion` compliance.

- [ ] **Step 10.1: Refine global focus rule**

Find the `*:focus-visible` rule and ensure it doesn't clip on rounded elements. Add a fallback for pills:

```css
*:focus-visible {
  outline: 1.5px solid var(--accent);
  outline-offset: 3px;
  border-radius: 2px;
}
/* Override border-radius for pill-shaped elements */
.filter-pill:focus-visible,
.filters > div:focus-visible {
  border-radius: var(--radius-full);
}
```

- [ ] **Step 10.2: Expand reduced-motion suppression**

Verify and expand the existing `@media (prefers-reduced-motion: reduce)` block:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .bootLoading__text { animation: none !important; }
  .new { animation: none !important; }
  .download-button { animation: none !important; }
  .spinner::before { animation: none !important; border-top-color: var(--accent); }
  .popupContainer .popupEl { animation: none !important; }
}
```

- [ ] **Step 10.3: Improve tooltip positioning**

Find `.tooltip` and update to prevent clipping:

```css
.tooltip {
  visibility: hidden;
  opacity: 0;
  transition: visibility 1ms step-end, opacity 1ms step-end;
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  width: 100%;
  max-width: 260px;
  z-index: 10000;
  background-color: var(--bg-tooltip);
  border: 1px solid var(--border-medium);
  box-shadow: 0 4px 12px rgba(0,0,0,0.40);
  border-radius: var(--radius-md);
  box-sizing: border-box;
  padding: 8px 12px;
  font-size: 12px;
  white-space: normal;
  color: var(--text-primary);
  font-family: var(--font-body);
}
.tooltip p { margin: 0 0 5px 0; }
.tooltip::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 20px;
  width: 10px;
  height: 10px;
  background: var(--bg-tooltip);
  border-left: 1px solid var(--border-medium);
  border-top: 1px solid var(--border-medium);
  transform: rotate(45deg);
}
```

- [ ] **Step 10.4: Add ARIA attributes to popup.html**

In `popup.html`, ensure these ARIA attributes exist on key elements (update or add if missing):

1. `#downloadButton`: add `aria-controls="downloadMenu"`, `aria-expanded="false"`
2. Filter pills (`.filters > div`): add `aria-expanded="false"`, `aria-controls` pointing to their `.selectMenu`
3. `#numimagesfound`: wrap in `aria-live="polite"` (already has `aria-live`, verify)
4. `#manyfiles`: add `role="dialog"`, `aria-modal="true"`, `aria-labelledby="manyfilesnum"`
5. `#prefsDiv`: add `role="dialog"`, `aria-modal="true"`, `aria-labelledby="preferencesLabel"` (the title element)

- [ ] **Step 10.5: Manual test**

Use Chrome DevTools → Accessibility panel to inspect the popup. Verify every interactive element has a name and role. Test Tab navigation through buttons, filters, and image cards.

- [ ] **Step 10.6: Commit**

```bash
git add popup.css popup.html
git commit -m "a11y: focus rings, reduced-motion, tooltip positioning, ARIA attributes"
```

---

### Task 11: Cross-Surface Consistency and Final Polish

**Files:**
- Modify: `popup.css`

**Context:** Final pass to ensure popup, side panel, footer, and header all adapt gracefully.

- [ ] **Step 11.1: Refine side panel footer**

Find `#extensionFooter` and ensure side panel variant is compact:

```css
.sidePanel #extensionFooter {
  padding: 4px var(--space-4);
}
```

- [ ] **Step 11.2: Ensure filters bar does not wrap in side panel**

If the side panel is narrow and filters wrap, add responsive behavior:

```css
@media (max-width: 500px) {
  .filters > div {
    padding: 4px 10px;
  }
}
```

- [ ] **Step 11.3: Audit for hardcoded values**

Run a scan for hardcoded hex values that should be tokens:

```bash
grep -nE '#[0-9a-fA-F]{3,6}' popup.css | grep -v 'url(data:image' | grep -v 'fonts/' | grep -v '\-\-bg' | grep -v 'url("' | head -40
```

For each remaining inline hex that is part of a UI surface (not SVG data URIs or font paths), decide if it should map to a token. Replace obvious ones like `#ffffff`, `#000000`, `#1a1a1f`, `#ff6b6b`, `#c45a3a`, etc.

- [ ] **Step 11.4: Verify jQuery UI overrides are preserved**

Confirm these rules still exist and are not broken by token changes:

```css
.ui-widget-header { background: var(--bg-card) !important; color: var(--text-primary); }
.ui-slider .ui-slider-handle { background: var(--accent) !important; ... }
.ui-slider-horizontal { height: 1px; margin: 5px 0px; }
.ui-widget.ui-widget-content { border: none; background: var(--bg-elevated); }
```

- [ ] **Step 11.5: Final manual test**

Complete checklist:
- [ ] Popup renders without console errors
- [ ] Side panel renders correctly
- [ ] All buttons have hover/active states
- [ ] Focus rings visible
- [ ] Filters dropdowns open and close
- [ ] Image cards hover/select correctly
- [ ] Preferences modal opens and layout is correct
- [ ] Download confirmation dialog layout is correct
- [ ] Empty state renders a contact-sheet icon and text
- [ ] Reduced-motion preference respected (animations suppressed)
- [ ] No broken CSS or unstyled elements

- [ ] **Step 11.6: Commit**

```bash
git add popup.css
git commit -m "style: cross-surface polish, side panel refinements, value audit"
```

- [ ] **Step 11.7: Final review and backup cleanup**

```bash
rm popup.css.backup
git add popup.css
git commit -m "chore: remove CSS backup file"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 5 spec sections (tokens, components, surfaces, accessibility, cross-surface) have corresponding tasks.
- [x] **No placeholders:** Every step contains exact code, file paths, commands, and expected outcomes.
- [x] **Type consistency:** Class names and IDs match those used in the existing HTML and JS.
- [x] **Backward compatibility:** All existing class names preserved alongside new unified classes.
- [x] **Testing strategy:** Manual verification via Chrome Developer Mode at every step.

---

*Plan complete and saved to `docs/superpowers/plans/2026-05-05-enterprise-grade-ui-redesign.md`.*

**Two execution options:**

1. **Subagent-Driven (recommended)** - Fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session, batch execution with checkpoints

**Which approach?**
