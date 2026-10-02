/**
 * Original implementation for Image Download - Batch by Ritesh Rana
 *
 * Area-screenshot helper injected on demand by the popup via
 * chrome.scripting.executeScript. Lets the user drag a rectangle over the
 * page, then sends the rectangle coordinates back to the extension so the
 * popup can call chrome.tabs.captureVisibleTab and crop the screenshot.
 */
(function () {
  'use strict';

  // Guard against double-injection when executeScript runs twice.
  if (window.__idbCaptureSelectionActive) {
    return;
  }
  window.__idbCaptureSelectionActive = true;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** @type {HTMLElement|null} full-page dimming overlay */
  let overlay = null;

  /** @type {HTMLElement|null} selection rectangle shown while dragging */
  let selectionBox = null;

  /** @type {HTMLElement|null} instructions banner */
  let instructions = null;

  /** @type {HTMLElement|null} injected <style> block */
  let styleEl = null;

  /** Starting pointer coordinates (clientX/clientY) of the drag. */
  let startX = 0;
  let startY = 0;

  /** Whether a drag is currently in progress. */
  let isDragging = false;

  /** Bound handler references so every listener can be removed cleanly. */
  const handlers = {
    onMouseDown: null,
    onMouseMove: null,
    onMouseUp: null,
    onKeyDown: null,
    onClearEvent: null,
  };

  // ---------------------------------------------------------------------------
  // Style injection
  // ---------------------------------------------------------------------------

  const STYLE_ID = '__idbCaptureSelectionStyle';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = [
      '.__idb-cs-overlay {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 2147483647;',
      '  background: rgba(0, 0, 0, 0.35);',
      '  cursor: crosshair;',
      '  user-select: none;',
      '  -webkit-user-select: none;',
      '}',
      '.__idb-cs-selection {',
      '  position: fixed;',
      '  z-index: 2147483647;',
      '  border: 2px solid #1a73e8;',
      '  background: rgba(26, 115, 232, 0.12);',
      '  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);',
      '  pointer-events: none;',
      '}',
      '.__idb-cs-instructions {',
      '  position: fixed;',
      '  top: 24px;',
      '  left: 50%;',
      '  transform: translateX(-50%);',
      '  z-index: 2147483647;',
      '  padding: 10px 18px;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '  font-size: 14px;',
      '  font-weight: 500;',
      '  color: #fff;',
      '  background: rgba(32, 33, 36, 0.9);',
      '  border-radius: 8px;',
      '  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);',
      '  pointer-events: none;',
      '  white-space: nowrap;',
      '}',
    ].join('\n');
    document.documentElement.appendChild(styleEl);
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = '__idb-cs-overlay';
    document.documentElement.appendChild(overlay);

    selectionBox = document.createElement('div');
    selectionBox.className = '__idb-cs-selection';
    selectionBox.style.display = 'none';
    document.documentElement.appendChild(selectionBox);

    instructions = document.createElement('div');
    instructions.className = '__idb-cs-instructions';
    instructions.textContent = 'Drag to select an area to capture  ·  Esc to cancel';
    document.documentElement.appendChild(instructions);
  }

  // ---------------------------------------------------------------------------
  // Drag handling
  // ---------------------------------------------------------------------------

  /**
   * @param {number} a first coordinate
   * @param {number} b second coordinate
   * @returns {{pos: number, size: number}} normalized origin and size
   */
  function normalize(a, b) {
    const pos = Math.min(a, b);
    const size = Math.abs(a - b);
    return { pos: pos, size: size };
  }

  function updateSelection(clientX, clientY) {
    if (!selectionBox) {
      return;
    }
    const x = normalize(startX, clientX);
    const y = normalize(startY, clientY);
    selectionBox.style.display = 'block';
    selectionBox.style.left = x.pos + 'px';
    selectionBox.style.top = y.pos + 'px';
    selectionBox.style.width = x.size + 'px';
    selectionBox.style.height = y.size + 'px';
  }

  /**
   * @param {MouseEvent} e
   */
  function onMouseDown(e) {
    // Ignore right-click.
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    updateSelection(e.clientX, e.clientY);
  }

  /**
   * @param {MouseEvent} e
   */
  function onMouseMove(e) {
    if (!isDragging) {
      return;
    }
    e.preventDefault();
    updateSelection(e.clientX, e.clientY);
  }

  /**
   * @param {MouseEvent} e
   */
  function onMouseUp(e) {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    e.preventDefault();

    const x = normalize(startX, e.clientX);
    const y = normalize(startY, e.clientY);

    // A meaningful drag must be larger than a few pixels — otherwise treat it
    // as a click and keep the overlay open so the user can try again.
    if (x.size < 4 || y.size < 4) {
      selectionBox.style.display = 'none';
      return;
    }

    const rect = {
      x: x.pos,
      y: y.pos,
      width: x.size,
      height: y.size,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };

    // Remove the dimming UI and let the page paint before taking its screenshot.
    teardown();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          chrome.runtime.sendMessage({ type: 'returnSelection', rect: rect }, function () {
            void chrome.runtime.lastError;
          });
        } catch (err) { /* extension context was invalidated */ }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Cancel / teardown
  // ---------------------------------------------------------------------------

  function onKeyDown(e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      e.preventDefault();
      e.stopPropagation();
      teardown();
    }
  }

  /**
   * Custom event dispatched by inject.js to programmatically exit selection
   * mode without user interaction.
   */
  function onClearEvent() {
    teardown();
  }

  function teardown() {
    if (overlay) {
      overlay.removeEventListener('mousedown', handlers.onMouseDown);
      overlay.removeEventListener('mousemove', handlers.onMouseMove);
      overlay.removeEventListener('mouseup', handlers.onMouseUp);
    }
    document.removeEventListener('keydown', handlers.onKeyDown, true);
    window.removeEventListener('idb-clear-selection', handlers.onClearEvent);

    [overlay, selectionBox, instructions].forEach(function (el) {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });

    if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);
    }

    overlay = null;
    selectionBox = null;
    instructions = null;
    styleEl = null;
    isDragging = false;

    window.__idbCaptureSelectionActive = false;
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  function start() {
    injectStyles();
    buildOverlay();

    handlers.onMouseDown = onMouseDown;
    handlers.onMouseMove = onMouseMove;
    handlers.onMouseUp = onMouseUp;
    handlers.onKeyDown = onKeyDown;
    handlers.onClearEvent = onClearEvent;

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('idb-clear-selection', onClearEvent);
  }

  start();
})();