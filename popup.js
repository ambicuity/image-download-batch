/**
 * Original implementation for Image Download - Batch by Ritesh Rana.
 *
 * Main UI controller for the popup / side-panel. Vanilla ES2015+ JS, no
 * jQuery, no minification, no build step.
 *
 * Responsibilities:
 *  - Initialise the popup, scrape images from the active tab, render cards.
 *  - Filters (size, type, layout, URL), sorting, select-all.
 *  - Download orchestration (single, batch, ZIP, canvas conversion).
 *  - Preferences dialog (read/write chrome.storage.local with imgdl_ prefix).
 *  - Area screenshot (side-panel only).
 *  - Localisation of messagesKey elements.
 *  - Port connection to the background service worker.
 *
 * Loaded BEFORE popup-bridge.js.  popup-bridge.js handles:
 *  - copy/export image URLs (#copyImageUrls, C / E / Ctrl-A shortcuts)
 *  - prefer-full-resolution toggle (#preferFullRes)
 *  - select-all icon restoration
 *  - two-column aria-pressed sync
 *
 * This file must NOT duplicate that functionality.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Section 0 — Constants & state
  // ---------------------------------------------------------------------------

  /** Threshold above which the "many files" warning dialog is shown. */
  var MANY_FILES_THRESHOLD = 30;

  /** Storage key prefix used by every preference. */
  var PREF_PREFIX = 'imgdl_';

  /** Storage keys for saved filter / download state (persisted across popups). */
  var STORAGE_KEYS = {
    DISPLAY_MODE: PREF_PREFIX + 'displayMode',
    BIGGER_VIEW: PREF_PREFIX + 'biggerview',
    TWO_COLS: PREF_PREFIX + 'twocols',
    DO_NOT_BOTHER: PREF_PREFIX + 'donotbother',
    ALL_FRAMES: PREF_PREFIX + 'allframes',
    SAVE_FOLDER_NAME: PREF_PREFIX + 'savefoldername',
    SAVE_FILE_AS: PREF_PREFIX + 'savefileas',
    SAVE_FILE_NAME: PREF_PREFIX + 'savefilename',
    CONVERT_FROM: PREF_PREFIX + 'convertfrom',
    CONVERT_TO: PREF_PREFIX + 'convertto',
    DOWNLOAD_AS_ZIP: PREF_PREFIX + 'downloadAsZip',
    SORT: PREF_PREFIX + 'sort',
    SIZE_TYPE: PREF_PREFIX + 'sizetype',
    MIN_WIDTH: PREF_PREFIX + 'minwidth',
    MIN_HEIGHT: PREF_PREFIX + 'minheight'
  };

  /** Recognised image file extensions (for type filtering & display). */
  var IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg',
    'bmp', 'ico', 'tif', 'tiff', 'jfif', 'heic', 'heif'];

  /**
   * Global mutable state — kept in one object so it's easy to reason about.
   */
  var state = {
    tabId: -1,
    tabUrl: '',
    allImages: [],
    stopRequested: false,
    isScraping: false,
    port: null,
    filters: {
      size: 'any',
      minWidth: 0,
      minHeight: 0,
      type: 'any',
      layout: 'any',
      url: '',
      sort: 'pixels'
    },
    downloadOptions: {
      saveFileAs: 'SYSTEM_NAME',
      saveFileName: '',
      saveFolderName: '',
      convertFrom: '',
      convertTo: 'jpeg',
      downloadAsZip: false
    },
    // Internal preference cache (populated by readPreferences).
    _prefDisplayMode: 'popup',
    _prefBiggerView: false,
    _prefTwoCols: false,
    _prefDoNotBother: false,
    _prefAllFrames: false,
    // Callback storage for the many-files dialog.
    _pendingDownload: null
  };

  // ---------------------------------------------------------------------------
  // Section 1 — Small DOM helpers
  // ---------------------------------------------------------------------------

  /** Shortcut for getElementById. */
  function byId(id) { return document.getElementById(id); }

  /** Shortcut for querySelector. */
  function qs(sel, root) { return (root || document).querySelector(sel); }

  /** Shortcut for querySelectorAll returning a real array. */
  function qsa(sel, root) {
    var list = (root || document).querySelectorAll(sel);
    return Array.prototype.slice.call(list);
  }

  /** Hide an element via display:none. */
  function hide(el) { if (el) el.style.display = 'none'; }

  /** Show an element (resets display to empty string). */
  function show(el) { if (el) el.style.display = ''; }

  /** Toggle a CSS class. */
  function toggleClass(el, cls, on) {
    if (!el) return;
    if (on) el.classList.add(cls); else el.classList.remove(cls);
  }

  /** Safely read an integer from a possibly-blank input value. */
  function intOrZero(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  /** Debounce helper for filter inputs. */
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var ctx = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms || 200);
    };
  }

  // ---------------------------------------------------------------------------
  // Section 10 — Localisation
  // ---------------------------------------------------------------------------

  /**
   * Replace the text content of every element with a messagesKey attribute
   * with chrome.i18n.getMessage(key).  Also update placeholders for elements
   * whose messagesKey should apply to the placeholder instead.
   */
  function localizeDocument() {
    var nodes = qsa('[messagesKey]');
    nodes.forEach(function (el) {
      var key = el.getAttribute('messagesKey');
      if (!key) return;
      var msg = chrome.i18n.getMessage(key);
      if (!msg) return;
      // The "foundLabel" message contains "%n" — keep the <span> intact.
      if (key === 'foundLabel') {
        el.innerHTML = msg.replace('%n', '<span>%n</span>');
        return;
      }
      // Some elements use messagesKey for their placeholder.
      if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
        el.setAttribute('placeholder', msg);
      } else {
        el.textContent = msg;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Section 2 — Initialization & port connection
  // ---------------------------------------------------------------------------

  /**
   * Entry point.  Runs on DOMContentLoaded.  Hides the boot overlay, reads
   * preferences, connects the port, localises, and kicks off scraping.
   */
  function init() {
    hide(byId('bootLoading'));

    localizeDocument();

    // Read all persisted preferences, apply them to checkboxes / selects,
    // then proceed to get the active tab and scrape.
    readPreferences(function () {
      getActiveTab(function (tab) {
        if (!tab) {
          showScrapeError('No active tab found.');
          return;
        }
        state.tabId = tab.id;
        state.tabUrl = tab.url || '';
        connectPort();
        startScraping();
      });
    });

    wireUI();
    wireFilters();
    wireDownloadMenu();
    wirePreferences();
    wireSelectAll();
    wireReloadAndStop();
    wireTwoColsToggle();
    wireCaptureSelection();
    wireManyFilesDialog();
    listenForReturnSelection();
  }

  /** Connect to background via chrome.runtime.connect. */
  function connectPort() {
    try {
      var name = 'idb-popup/' + state.tabId;
      if (state.tabId < 0) name = 'idb-popup/0';
      state.port = chrome.runtime.connect({ name: name });
    } catch (e) {
      // Non-fatal: port is for cleanup hints only.
    }
  }

  /** Get the currently active tab in the current window. */
  function getActiveTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (chrome.runtime.lastError || !tabs || !tabs.length) {
        cb(null);
        return;
      }
      cb(tabs[0]);
    });
  }

  // ---------------------------------------------------------------------------
  // Section 3 — Scraping
  // ---------------------------------------------------------------------------

  /**
   * Inject imageScraper.js into the active tab (all frames when the
   * "all frames" preference is on) and collect the results.  Flattens and
   * deduplicates the image URLs returned from every frame, then renders.
   */
  function startScraping() {
    if (state.isScraping) return;
    state.isScraping = true;
    state.stopRequested = false;

    show(byId('searchingimages'));
    hide(byId('numimagesfound'));
    show(byId('stopImageSearch'));
    show(byId('spinner'));

    var allFrames = !!state._prefAllFrames;
    var target = { tabId: state.tabId, allFrames: allFrames };

    chrome.scripting.executeScript(
      { target: target, files: ['imageScraper.js'] },
      function (results) {
        if (chrome.runtime.lastError) {
          showScrapeError(chrome.runtime.lastError.message || 'Scraping failed');
          finishScraping([]);
          return;
        }
        if (state.stopRequested) {
          finishScraping([]);
          return;
        }
        var urls = collectImageUrls(results);
        finishScraping(urls);
      }
    );
  }

  /**
   * Collect & dedupe image URLs from executeScript results array.
   * @param {Array} results - chrome.scripting.executeScript results
   * @returns {string[]}
   */
  function collectImageUrls(results) {
    var seen = Object.create(null);
    var out = [];
    if (!results) return out;
    for (var i = 0; i < results.length; i++) {
      var res = results[i] && results[i].result;
      if (!res || !res.images) continue;
      for (var j = 0; j < res.images.length; j++) {
        var u = res.images[j];
        if (typeof u !== 'string' || !u.trim()) continue;
        var key = u.trim();
        if (seen[key]) continue;
        seen[key] = true;
        out.push(key);
      }
    }
    return out;
  }

  /** Scraping is done (success or cancelled) — render and reset UI. */
  function finishScraping(urls) {
    state.isScraping = false;
    hide(byId('stopImageSearch'));
    hide(byId('spinner'));
    hide(byId('searchingimages'));

    state.allImages = urls.map(function (url, idx) {
      return { url: url, index: idx, w: 0, h: 0, loaded: false };
    });

    renderImages();
    showFoundCount(urls.length);
  }

  /** Update the "Found N images" label and show the reload button. */
  function showFoundCount(n) {
    var foundDiv = byId('numimagesfound');
    if (!foundDiv) return;
    show(foundDiv);
    var label = qs('[messagesKey="foundLabel"]', foundDiv);
    if (label) {
      var msg = chrome.i18n.getMessage('foundLabel') || 'Found %n images';
      label.innerHTML = msg.replace('%n', '<span>' + n + '</span>');
    }
    // Reveal the select-all button once images are present.
    var sa = byId('selectalla');
    if (sa && n > 0) sa.style.visibility = 'visible';
  }

  /** Show an error in place of the spinner. */
  function showScrapeError(msg) {
    var sp = byId('spinner');
    if (sp) sp.textContent = msg || 'Error';
  }

  // ---------------------------------------------------------------------------
  // Section 4 — Image card rendering
  // ---------------------------------------------------------------------------

  /**
   * Clear #imgsContainer and build a card for every image in state.allImages
   * (filtered/sorted), then probe each image for dimensions.
   */
  function renderImages() {
    var container = byId('imgsContainer');
    if (!container) return;

    // Remove existing cards (keep the spinner, which is a child element).
    qsa('.imgContainer', container).forEach(function (c) { c.remove(); });

    var visible = applyFiltersAndSort(state.allImages);

    visible.forEach(function (img) {
      var card = buildImageCard(img);
      container.appendChild(card);
      probeImageDimensions(img, card);
    });

    updateSelectAllState();
  }

  /**
   * Build a single image card element.
   * @param {Object} img - {url, index, w, h, loaded}
   * @returns {HTMLElement}
   */
  function buildImageCard(img) {
    var card = document.createElement('div');
    card.className = 'imgContainer';
    card.setAttribute('imgsrc', img.url);
    card.setAttribute('data-index', String(img.index));

    // Thumbnail preview.
    var thumb = document.createElement('img');
    thumb.className = 'imgThumb';
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.onerror = function () {
      thumb.classList.add('imgThumb--error');
      thumb.removeAttribute('src');
      thumb.setAttribute('data-error', '1');
    };
    thumb.onload = function () {
      img.loaded = true;
      img.w = thumb.naturalWidth || 0;
      img.h = thumb.naturalHeight || 0;
      updateCardMeta(card, img);
    };
    thumb.src = img.url;
    card.appendChild(thumb);

    // Selection checkbox.
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'imgCheckbox';
    cb.setAttribute('aria-label', 'Select image');
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () {
      toggleClass(card, 'imgSelected', cb.checked);
      updateSelectAllState();
      sendSelectedImagesToTab();
    });
    card.appendChild(cb);

    // Meta info: dimensions, type.
    var meta = document.createElement('div');
    meta.className = 'imgMeta';
    card.appendChild(meta);
    updateCardMeta(card, img);

    // Action buttons.
    var actions = document.createElement('div');
    actions.className = 'imgActions';
    card.appendChild(actions);

    actions.appendChild(actionButton('openinnewtab', 'Open', function () {
      window.open(img.url, '_blank');
    }));
    actions.appendChild(actionButton('download', 'Download', function () {
      downloadSingleImage(img.url);
    }));
    actions.appendChild(actionButton('convert', 'Convert', function () {
      convertAndDownloadSingle(img.url, card);
    }));
    actions.appendChild(actionButton('searchsimilarimgs', 'Search', function () {
      reverseImageSearch(img.url);
    }));

    // Clicking anywhere on the card toggles selection.
    card.addEventListener('click', function (e) {
      if (e.target === cb || e.target.closest('.imgActions')) return;
      cb.checked = !cb.checked;
      toggleClass(card, 'imgSelected', cb.checked);
      updateSelectAllState();
      sendSelectedImagesToTab();
    });

    return card;
  }

  /** Create a small labelled action button. */
  function actionButton(labelKey, fallback, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'imgAction';
    btn.textContent = chrome.i18n.getMessage(labelKey) || fallback;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  /**
   * Probe the natural dimensions of an image by creating an off-screen Image.
   * Used as a fallback when the thumbnail <img> hasn't loaded yet.
   */
  function probeImageDimensions(img, card) {
    if (img.loaded) return;
    var probe = new Image();
    probe.onload = function () {
      img.loaded = true;
      img.w = probe.naturalWidth || 0;
      img.h = probe.naturalHeight || 0;
      updateCardMeta(card, img);
    };
    probe.onerror = function () { /* leave dimensions at 0 */ };
    probe.src = img.url;
  }

  /** Update the meta (dimensions / type) text inside a card. */
  function updateCardMeta(card, img) {
    var meta = qs('.imgMeta', card);
    if (!meta) return;
    var ext = getExtensionFromUrl(img.url);
    var dim = (img.w && img.h) ? (img.w + 'x' + img.h) : '--';
    meta.textContent = dim + ' - ' + (ext || '?');
  }

  /** Extract the file extension (uppercased) from a URL string. */
  function getExtensionFromUrl(url) {
    if (!url) return '';
    if (url.indexOf('data:') === 0) {
      var m = url.match(/^data:image\/([a-z0-9.+-]+);/i);
      if (m) return m[1].split('+')[0].toUpperCase();
      return 'DATA';
    }
    try {
      var path = new URL(url).pathname;
      var dot = path.lastIndexOf('.');
      if (dot === -1) return '';
      var ext = path.slice(dot + 1).toUpperCase();
      // Normalise JPEG -> JPG for display consistency.
      return ext === 'JPEG' ? 'JPG' : ext;
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Section 5 — Filters & sorting
  // ---------------------------------------------------------------------------

  /** Apply the current filter state to the image list and return the sorted result. */
  function applyFiltersAndSort(images) {
    var f = state.filters;
    var out = images.filter(function (img) {
      // Size filter.
      if (f.size === 'small' && img.loaded) {
        if (!(Math.max(img.w, img.h) < 200)) return false;
      } else if (f.size === 'medium' && img.loaded) {
        var mx = Math.max(img.w, img.h);
        if (!(mx >= 200 && mx <= 500)) return false;
      } else if (f.size === 'large' && img.loaded) {
        if (!(Math.max(img.w, img.h) > 500)) return false;
      } else if (f.size === 'custom' && img.loaded) {
        if (img.w < f.minWidth || img.h < f.minHeight) return false;
      }

      // Type filter.
      if (f.type !== 'any') {
        var ext = getExtensionFromUrl(img.url);
        if (f.type === 'JPG' && ext !== 'JPG' && ext !== 'JPEG') return false;
        if (f.type !== 'JPG' && ext !== f.type) return false;
      }

      // Layout filter.
      if (f.layout !== 'any' && img.loaded && img.w > 0 && img.h > 0) {
        var ratio = img.w / img.h;
        if (f.layout === 'square') {
          if (Math.abs(ratio - 1) > 0.15) return false;
        } else if (f.layout === 'wide') {
          if (ratio <= 1.15) return false;
        } else if (f.layout === 'tall') {
          if (ratio >= 0.87) return false;
        }
      }

      // URL filter.
      if (f.url) {
        var lower = img.url.toLowerCase();
        if (lower.indexOf(f.url.toLowerCase()) === -1) {
          var fn = tryFilename(img.url).toLowerCase();
          if (fn.indexOf(f.url.toLowerCase()) === -1) return false;
        }
      }
      return true;
    });

    // Sorting.
    if (f.sort === 'pixels') {
      out.sort(function (a, b) {
        var pa = (a.w || 0) * (a.h || 0);
        var pb = (b.w || 0) * (b.h || 0);
        return pb - pa;
      });
    } else if (f.sort === 'index') {
      out.sort(function (a, b) { return a.index - b.index; });
    }
    return out;
  }

  /** Best-effort filename extraction from a URL. */
  function tryFilename(url) {
    try {
      var path = new URL(url).pathname;
      var slash = path.lastIndexOf('/');
      return slash === -1 ? path : path.slice(slash + 1);
    } catch (e) {
      return url;
    }
  }

  /** Wire up all filter dropdowns and the URL input. */
  function wireFilters() {
    // Size dropdown.
    var sizeTab = byId('sizeTab');
    if (sizeTab) {
      var sizeMenu = qs('.sizeMenu', sizeTab);
      qsa('[sizeconf]', sizeMenu).forEach(function (item) {
        item.addEventListener('click', function () {
          qsa('[sizeconf]', sizeMenu).forEach(function (o) {
            o.classList.remove('selected');
          });
          item.classList.add('selected');
          var conf = item.getAttribute('sizeconf');
          state.filters.size = conf;
          if (conf === 'custom') {
            var mw = byId('minwidthinput');
            var mh = byId('minheightinput');
            if (mw) state.filters.minWidth = intOrZero(mw.value);
            if (mh) state.filters.minHeight = intOrZero(mh.value);
          }
          renderImages();
          showClearFilters();
        });
      });
      // Save-size link.
      var saveSize = qs('[savesize]', sizeMenu);
      if (saveSize) {
        saveSize.addEventListener('click', function () {
          var mw = byId('minwidthinput');
          var mh = byId('minheightinput');
          var obj = {};
          obj[STORAGE_KEYS.SIZE_TYPE] = state.filters.size;
          obj[STORAGE_KEYS.MIN_WIDTH] = intOrZero(mw ? mw.value : 0);
          obj[STORAGE_KEYS.MIN_HEIGHT] = intOrZero(mh ? mh.value : 0);
          chrome.storage.local.set(obj);
        });
      }
    }

    // Type dropdown.
    wireDropdownMenu('Filter by type', 'typeconf', 'type');

    // Layout dropdown.
    wireDropdownMenu('Filter by layout', 'layoutconf', 'layout');

    // URL filter input.
    var urlInput = byId('filterbyurlinput');
    if (urlInput) {
      urlInput.addEventListener('input', debounce(function () {
        state.filters.url = urlInput.value;
        renderImages();
        showClearFilters();
      }, 250));
    }

    // Sort dropdown.
    var sortTab = byId('sortTab');
    if (sortTab) {
      var sortMenu = qs('.sortMenu', sortTab);
      qsa('[sortconf]', sortMenu).forEach(function (item) {
        item.addEventListener('click', function () {
          qsa('[sortconf]', sortMenu).forEach(function (o) {
            o.classList.remove('selected');
          });
          item.classList.add('selected');
          state.filters.sort = item.getAttribute('sortconf');
          renderImages();
          showClearFilters();
        });
      });
    }

    // Clear filters.
    var clearBtn = qs('.clearFilters');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearFilters);
    }
  }

  /**
   * Generic helper: wire a dropdown menu whose options carry a data attribute
   * and set state.filters[key] when clicked.  Finds the menu host by its
   * aria-label attribute value.
   */
  function wireDropdownMenu(ariaLabel, attrName, filterKey) {
    var host = document.querySelector('[aria-label="' + ariaLabel + '"]');
    if (!host) return;
    var menu = qs('.selectMenu', host);
    if (!menu) return;
    qsa('[' + attrName + ']', menu).forEach(function (item) {
      item.addEventListener('click', function () {
        qsa('[' + attrName + ']', menu).forEach(function (o) {
          o.classList.remove('selected');
        });
        item.classList.add('selected');
        state.filters[filterKey] = item.getAttribute(attrName);
        renderImages();
        showClearFilters();
      });
    });
  }

  /** Show the "Clear" button if any filter is active. */
  function showClearFilters() {
    var f = state.filters;
    var active = f.size !== 'any' || f.type !== 'any' ||
      f.layout !== 'any' || f.url !== '' || f.sort !== 'pixels' ||
      f.minWidth > 0 || f.minHeight > 0;
    var clearBtn = qs('.clearFilters');
    if (clearBtn) clearBtn.style.display = active ? '' : 'none';
  }

  /** Reset every filter to its default and re-render. */
  function clearFilters() {
    state.filters = {
      size: 'any', minWidth: 0, minHeight: 0,
      type: 'any', layout: 'any', url: '', sort: 'pixels'
    };
    // Reset the DOM to match.
    qsa('[sizeconf]').forEach(function (o) {
      o.classList.toggle('selected', o.getAttribute('sizeconf') === 'any');
    });
    qsa('[typeconf]').forEach(function (o) {
      o.classList.toggle('selected', o.getAttribute('typeconf') === 'any');
    });
    qsa('[layoutconf]').forEach(function (o) {
      o.classList.toggle('selected', o.getAttribute('layoutconf') === 'any');
    });
    qsa('[sortconf]').forEach(function (o) {
      o.classList.toggle('selected', o.getAttribute('sortconf') === 'pixels');
    });
    var urlInput = byId('filterbyurlinput');
    if (urlInput) urlInput.value = '';
    renderImages();
    showClearFilters();
  }

  // ---------------------------------------------------------------------------
  // Section 6 — Select all / Deselect all
  // ---------------------------------------------------------------------------

  /** Wire the #selectalla button. */
  function wireSelectAll() {
    var btn = byId('selectalla');
    if (!btn) return;
    btn.addEventListener('click', toggleSelectAll);
  }

  /** Toggle selection on every visible (non-excluded) image card. */
  function toggleSelectAll() {
    var cards = qsa('.imgContainer:not(.excluded)');
    if (!cards.length) return;
    // If any visible card is unselected, select all; otherwise deselect all.
    var anyUnselected = cards.some(function (c) {
      return !c.classList.contains('imgSelected');
    });
    cards.forEach(function (c) {
      toggleClass(c, 'imgSelected', anyUnselected);
      var cb = qs('.imgCheckbox', c);
      if (cb) cb.checked = anyUnselected;
    });
    updateSelectAllState(anyUnselected);
    sendSelectedImagesToTab();
  }

  /** Reflect selection state on the select-all button. */
  function updateSelectAllState(forceSelected) {
    var btn = byId('selectalla');
    if (!btn) return;
    var cards = qsa('.imgContainer:not(.excluded)');
    var selected = qsa('.imgContainer.imgSelected:not(.excluded)');
    var allSelected = cards.length > 0 && selected.length === cards.length;
    if (typeof forceSelected === 'boolean') allSelected = forceSelected;
    btn.classList.toggle('--active', allSelected);
    btn.setAttribute('aria-pressed', allSelected ? 'true' : 'false');
    btn.setAttribute('title', allSelected
      ? (chrome.i18n.getMessage('deselectall') || 'Deselect all')
      : (chrome.i18n.getMessage('selectall') || 'Select all'));
  }

  /**
   * Send the current selection to the content script (inject.js) so it can
   * highlight the selected images on the page.  Called after any selection
   * change (individual card toggle, select-all, or deselect-all).
   */
  function sendSelectedImagesToTab() {
    if (state.tabId < 0) return;
    var selected = qsa('.imgContainer.imgSelected:not(.excluded)');
    var urls = [];
    for (var i = 0; i < selected.length; i++) {
      var u = selected[i].getAttribute('imgsrc');
      if (u) urls.push(u);
    }
    try {
      chrome.tabs.sendMessage(state.tabId, {
        type: 'sendSelectedImages',
        urls: urls
      }, function () { if (chrome.runtime.lastError) {} });
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Section 7 — Download orchestration
  // ---------------------------------------------------------------------------

  /** Wire the download menu toggle and the save-download-options button. */
  function wireDownloadMenu() {
    var btn = byId('downloadButton');
    var menu = byId('downloadMenu');
    if (btn && menu) {
      btn.addEventListener('click', function () {
        var open = menu.style.display === 'block';
        if (open) { hide(menu); btn.setAttribute('aria-expanded', 'false'); }
        else { show(menu); btn.setAttribute('aria-expanded', 'true'); }
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
      });
    }

    var saveBtn = byId('saveDownloadOptionsButton');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        captureDownloadOptionsFromMenu();
        persistDownloadOptions();
        sendDownloadOptionsToBackground();
        triggerDownload();
      });
    }
  }

  /** Read the download options from the menu DOM into state. */
  function captureDownloadOptionsFromMenu() {
    var folder = byId('savefoldername');
    var fileAs = byId('saveFileAs');
    var fileName = byId('saveFileName');
    var convFrom = byId('convertFrom');
    var convTo = byId('convertTo');
    var zip = byId('downloadAsZip');
    state.downloadOptions.saveFolderName = folder ? folder.value.trim() : '';
    state.downloadOptions.saveFileAs = fileAs ? fileAs.value : 'SYSTEM_NAME';
    state.downloadOptions.saveFileName = fileName ? fileName.value.trim() : '';
    state.downloadOptions.convertFrom = convFrom ? convFrom.value : '';
    state.downloadOptions.convertTo = convTo ? convTo.value : 'jpeg';
    state.downloadOptions.downloadAsZip = !!(zip && zip.checked);
  }

  /** Persist the current download options to chrome.storage.local. */
  function persistDownloadOptions() {
    var o = state.downloadOptions;
    var obj = {};
    obj[STORAGE_KEYS.SAVE_FOLDER_NAME] = o.saveFolderName;
    obj[STORAGE_KEYS.SAVE_FILE_AS] = o.saveFileAs;
    obj[STORAGE_KEYS.SAVE_FILE_NAME] = o.saveFileName;
    obj[STORAGE_KEYS.CONVERT_FROM] = o.convertFrom;
    obj[STORAGE_KEYS.CONVERT_TO] = o.convertTo;
    obj[STORAGE_KEYS.DOWNLOAD_AS_ZIP] = o.downloadAsZip;
    try { chrome.storage.local.set(obj); } catch (e) {}
  }

  /** Send the current download options to the background service worker. */
  function sendDownloadOptionsToBackground() {
    var o = state.downloadOptions;
    try {
      chrome.runtime.sendMessage({
        msg: 'setDownloadOptions',
        downloadOptions: {
          saveFileAs: o.saveFileAs,
          saveFileName: o.saveFileName,
          saveFolderName: o.saveFolderName
        }
      });
    } catch (e) {}
  }

  /**
   * Trigger the download flow.  Gathers selected image URLs (or all if none
   * selected), shows the many-files warning if needed, then downloads.
   */
  function triggerDownload() {
    var urls = getSelectedOrAllUrls();
    if (!urls.length) return;

    captureDownloadOptionsFromMenu();

    var doNotBother = state._prefDoNotBother;
    if (urls.length > MANY_FILES_THRESHOLD && !doNotBother) {
      showManyFilesDialog(urls.length, function () {
        runDownloads(urls);
      });
    } else {
      runDownloads(urls);
    }
  }

  /** Get selected image URLs, or all visible URLs if none selected. */
  function getSelectedOrAllUrls() {
    var selected = qsa('.imgContainer.imgSelected:not(.excluded)');
    var nodes = selected.length ? selected : qsa('.imgContainer:not(.excluded)');
    var urls = [];
    nodes.forEach(function (n) {
      var u = n.getAttribute('imgsrc');
      if (u) urls.push(u);
    });
    return urls;
  }

  /** Actually download (or ZIP) the given list of image URLs. */
  function runDownloads(urls) {
    sendDownloadOptionsToBackground();

    if (state.downloadOptions.downloadAsZip) {
      downloadAsZip(urls);
      return;
    }

    var convFrom = state.downloadOptions.convertFrom;
    var convTo = state.downloadOptions.convertTo;

    urls.forEach(function (url, idx) {
      if (shouldConvert(url, convFrom, convTo)) {
        convertImage(url, convTo, function (dataUrl) {
          if (dataUrl) downloadDataUrl(dataUrl, url, idx);
          else downloadSingleImage(url);
        });
      } else {
        downloadSingleImage(url, idx);
      }
    });
  }

  /** Decide whether a given image URL should be converted. */
  function shouldConvert(url, convFrom, convTo) {
    if (!convFrom || !convTo) return false;
    var ext = getExtensionFromUrl(url);
    if (convFrom === 'ALL') return true;
    if (convFrom === 'JPG' && (ext === 'JPG' || ext === 'JPEG')) return true;
    return ext === convFrom.toUpperCase();
  }

  /** Download a single image URL via chrome.downloads. */
  function downloadSingleImage(url, index) {
    try {
      chrome.downloads.download({
        url: url,
        conflictAction: 'uniquify'
      });
    } catch (e) {
      // Fallback: open in new tab so the user can save manually.
      window.open(url, '_blank');
    }
  }

  /**
   * Convert an image via canvas to the target MIME type and call back with a
   * data: URL (or null on failure).
   */
  function convertImage(url, targetFormat, cb) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var mime = 'image/' + targetFormat;
        var dataUrl = canvas.toDataURL(mime, 0.92);
        cb(dataUrl);
      } catch (e) {
        // Canvas tainted (CORS) — fall back to raw download.
        cb(null);
      }
    };
    img.onerror = function () { cb(null); };
    img.src = url;
  }

  /** Download a data: URL via a Blob. */
  function downloadDataUrl(dataUrl, originalUrl, index) {
    try {
      var blob = dataUrlToBlob(dataUrl);
      if (!blob) { downloadSingleImage(originalUrl, index); return; }
      var objUrl = URL.createObjectURL(blob);
      chrome.downloads.download({
        url: objUrl,
        conflictAction: 'uniquify'
      }, function () {
        setTimeout(function () { URL.revokeObjectURL(objUrl); }, 5000);
      });
    } catch (e) {
      downloadSingleImage(originalUrl, index);
    }
  }

  /** Convert a data: URL to a Blob. */
  function dataUrlToBlob(dataUrl) {
    try {
      var comma = dataUrl.indexOf(',');
      if (comma === -1) return null;
      var meta = dataUrl.slice(5, comma); // strip "data:"
      var mime = meta.split(';')[0] || 'application/octet-stream';
      var isBase64 = meta.indexOf('base64') !== -1;
      var raw = dataUrl.slice(comma + 1);
      var bytes;
      if (isBase64) {
        bytes = atob(raw);
      } else {
        bytes = unescape(encodeURIComponent(raw));
      }
      var arr = new Uint8Array(bytes.length);
      for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) {
      return null;
    }
  }

  /** Convert & download a single image (button on a card). */
  function convertAndDownloadSingle(url, card) {
    captureDownloadOptionsFromMenu();
    var convTo = state.downloadOptions.convertTo || 'jpeg';
    convertImage(url, convTo, function (dataUrl) {
      if (dataUrl) downloadDataUrl(dataUrl, url, 0);
      else downloadSingleImage(url);
    });
  }

  /**
   * Build a ZIP archive from the given URLs and trigger a single download.
   * Dynamically loads 733.js (which defines globalThis.JSZip) if needed.
   */
  function downloadAsZip(urls) {
    function buildWithJsZip() {
      if (typeof globalThis.JSZip !== 'function') {
        // Try again shortly — the script tag may still be loading.
        setTimeout(buildWithJsZip, 100);
        return;
      }
      var zip = new globalThis.JSZip();
      var pending = urls.length;
      var folderName = state.downloadOptions.saveFolderName || '';
      var zipFolder = folderName ? zip.folder(folderName) : zip;
      var baseName = state.downloadOptions.saveFileName || 'image';

      urls.forEach(function (url, idx) {
        var filename = baseName + '_' + (idx + 1) + '.' + defaultExt(url);
        fetchAsBlob(url, function (blob) {
          if (blob) zipFolder.file(filename, blob);
          pending--;
          if (pending === 0) {
            zip.generateAsync({ type: 'blob' }).then(function (blob) {
              var objUrl = URL.createObjectURL(blob);
              var zipName = (folderName ? sanitizeFilename(folderName) : 'images') + '.zip';
              chrome.downloads.download({
                url: objUrl,
                filename: zipName,
                conflictAction: 'uniquify'
              }, function () {
                setTimeout(function () { URL.revokeObjectURL(objUrl); }, 5000);
              });
            });
          }
        });
      });
    }

    if (typeof globalThis.JSZip === 'function') {
      buildWithJsZip();
    } else {
      injectScript('733.js', function () {
        buildWithJsZip();
      });
    }
  }

  /** Fetch a URL as a Blob (CORS permitting). */
  function fetchAsBlob(url, cb) {
    // Handle data: URLs directly.
    if (url.indexOf('data:') === 0) {
      cb(dataUrlToBlob(url));
      return;
    }
    try {
      fetch(url, { mode: 'cors' })
        .then(function (r) { return r.blob(); })
        .then(function (b) { cb(b); })
        .catch(function () { cb(null); });
    } catch (e) {
      cb(null);
    }
  }

  /** Default file extension for a URL based on its type. */
  function defaultExt(url) {
    var ext = getExtensionFromUrl(url).toLowerCase();
    if (IMAGE_EXTENSIONS.indexOf(ext) !== -1) return ext === 'jpeg' ? 'jpg' : ext;
    return 'jpg';
  }

  /** Inject a script tag and call back when it has loaded. */
  function injectScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = function () { if (cb) cb(); };
    s.onerror = function () { if (cb) cb(); };
    document.head.appendChild(s);
  }

  /** Reverse image search via Google Images. */
  function reverseImageSearch(url) {
    var searchUrl = 'https://www.google.com/searchbyimage?sbisrc=cr_1&image_url=' +
      encodeURIComponent(url);
    window.open(searchUrl, '_blank');
  }

  // ---------------------------------------------------------------------------
  // Section 8 — Many-files warning dialog
  // ---------------------------------------------------------------------------

  /** Wire the many-files dialog buttons. */
  function wireManyFilesDialog() {
    var dl = byId('manyfilesdownload');
    var cancel = byId('manyfilescancel');
    if (dl) dl.addEventListener('click', function () {
      hide(byId('manyfiles'));
      // Persist the "don't bother" checkbox if checked.
      var cb = byId('donotbotherme');
      if (cb && cb.checked) {
        state._prefDoNotBother = true;
        var obj = {};
        obj[STORAGE_KEYS.DO_NOT_BOTHER] = true;
        try { chrome.storage.local.set(obj); } catch (e) {}
      }
      if (state._pendingDownload) {
        var fn = state._pendingDownload;
        state._pendingDownload = null;
        fn();
      }
    });
    if (cancel) cancel.addEventListener('click', function () {
      hide(byId('manyfiles'));
      state._pendingDownload = null;
    });
  }

  /** Show the many-files dialog with the count and a callback to run on confirm. */
  function showManyFilesDialog(count, onConfirm) {
    var dlg = byId('manyfiles');
    var title = byId('manyfilesnum');
    if (title) {
      var msg = chrome.i18n.getMessage('manyfilesnum') || 'Download %n images';
      title.textContent = msg.replace('%n', String(count));
    }
    state._pendingDownload = onConfirm;
    if (dlg) show(dlg);
  }

  // ---------------------------------------------------------------------------
  // Section 9 — Preferences
  // ---------------------------------------------------------------------------

  /**
   * Read every persisted preference from chrome.storage.local, apply it to
   * the checkboxes / selects, and populate state.downloadOptions.  Then
   * call cb().
   */
  function readPreferences(cb) {
    var keys = Object.keys(STORAGE_KEYS).map(function (k) {
      return STORAGE_KEYS[k];
    });
    try {
      chrome.storage.local.get(keys, function (cfg) {
        applyPreferences(cfg || {});
        if (cb) cb();
      });
    } catch (e) {
      applyPreferences({});
      if (cb) cb();
    }
  }

  /** Apply a storage config object to the DOM & state. */
  function applyPreferences(cfg) {
    // Side-panel mode.
    state._prefDisplayMode = cfg[STORAGE_KEYS.DISPLAY_MODE] || 'popup';
    var sidePanelCb = byId('displayInSidePanel');
    if (sidePanelCb) sidePanelCb.checked = state._prefDisplayMode === 'sidePanel';

    // Bigger view.
    state._prefBiggerView = !!cfg[STORAGE_KEYS.BIGGER_VIEW];
    var biggerCb = byId('biggerview');
    if (biggerCb) biggerCb.checked = state._prefBiggerView;
    if (state._prefBiggerView) document.body.classList.add('biggerView');

    // Two columns.
    state._prefTwoCols = !!cfg[STORAGE_KEYS.TWO_COLS];
    var twocolsCb = byId('twocols');
    if (twocolsCb) twocolsCb.checked = state._prefTwoCols;
    if (state._prefTwoCols) document.body.classList.add('twocols');

    // Don't bother with many-files warning.
    state._prefDoNotBother = !!cfg[STORAGE_KEYS.DO_NOT_BOTHER];
    var dn = byId('donotbother');
    if (dn) dn.checked = state._prefDoNotBother;

    // All frames.
    state._prefAllFrames = !!cfg[STORAGE_KEYS.ALL_FRAMES];
    var af = byId('allframes');
    if (af) af.checked = state._prefAllFrames;

    // Download options.
    state.downloadOptions.saveFolderName = cfg[STORAGE_KEYS.SAVE_FOLDER_NAME] || '';
    state.downloadOptions.saveFileAs = cfg[STORAGE_KEYS.SAVE_FILE_AS] || 'SYSTEM_NAME';
    state.downloadOptions.saveFileName = cfg[STORAGE_KEYS.SAVE_FILE_NAME] || '';
    state.downloadOptions.convertFrom = cfg[STORAGE_KEYS.CONVERT_FROM] || '';
    state.downloadOptions.convertTo = cfg[STORAGE_KEYS.CONVERT_TO] || 'jpeg';
    state.downloadOptions.downloadAsZip = !!cfg[STORAGE_KEYS.DOWNLOAD_AS_ZIP];

    // Populate the download menu inputs.
    setVal('savefoldername', state.downloadOptions.saveFolderName);
    setVal('saveFileAs', state.downloadOptions.saveFileAs);
    setVal('saveFileName', state.downloadOptions.saveFileName);
    setVal('convertFrom', state.downloadOptions.convertFrom);
    setVal('convertTo', state.downloadOptions.convertTo);
    setChecked('downloadAsZip', state.downloadOptions.downloadAsZip);

    // Persisted filters.
    var sizeType = cfg[STORAGE_KEYS.SIZE_TYPE] || 'any';
    state.filters.size = sizeType;
    state.filters.minWidth = intOrZero(cfg[STORAGE_KEYS.MIN_WIDTH]);
    state.filters.minHeight = intOrZero(cfg[STORAGE_KEYS.MIN_HEIGHT]);
    var mw = byId('minwidthinput'); if (mw) mw.value = state.filters.minWidth || 0;
    var mh = byId('minheightinput'); if (mh) mh.value = state.filters.minHeight || 0;
    qsa('[sizeconf]').forEach(function (o) {
      o.classList.toggle('selected', o.getAttribute('sizeconf') === sizeType);
    });
  }

  /** Set the value of a <select> or <input> by id. */
  function setVal(id, v) {
    var el = byId(id);
    if (el) el.value = v;
  }

  /** Set the checked state of a checkbox by id. */
  function setChecked(id, v) {
    var el = byId(id);
    if (el) el.checked = !!v;
  }

  /** Wire preferences dialog: open, save, cancel, side-panel toggle. */
  function wirePreferences() {
    var showBtn = byId('showPrefs');
    var prefsDiv = byId('prefsDiv');
    if (showBtn && prefsDiv) {
      showBtn.addEventListener('click', function () {
        show(prefsDiv);
      });
    }
    var saveBtn = byId('saveprefs');
    if (saveBtn) saveBtn.addEventListener('click', savePreferences);
    var cancelBtn = byId('saveprefscancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      hide(prefsDiv);
    });
  }

  /** Read the preferences dialog checkboxes and persist them. */
  function savePreferences() {
    var sidePanelCb = byId('displayInSidePanel');
    var biggerCb = byId('biggerview');
    var twocolsCb = byId('twocols');
    var dn = byId('donotbother');
    var af = byId('allframes');

    var displayMode = (sidePanelCb && sidePanelCb.checked) ? 'sidePanel' : 'popup';
    var bigger = !!(biggerCb && biggerCb.checked);
    var twocols = !!(twocolsCb && twocolsCb.checked);
    var doNotBother = !!(dn && dn.checked);
    var allframes = !!(af && af.checked);

    state._prefDisplayMode = displayMode;
    state._prefBiggerView = bigger;
    state._prefTwoCols = twocols;
    state._prefDoNotBother = doNotBother;
    state._prefAllFrames = allframes;

    var obj = {};
    obj[STORAGE_KEYS.DISPLAY_MODE] = displayMode;
    obj[STORAGE_KEYS.BIGGER_VIEW] = bigger;
    obj[STORAGE_KEYS.TWO_COLS] = twocols;
    obj[STORAGE_KEYS.DO_NOT_BOTHER] = doNotBother;
    obj[STORAGE_KEYS.ALL_FRAMES] = allframes;
    try { chrome.storage.local.set(obj); } catch (e) {}

    // Apply visual changes immediately.
    document.body.classList.toggle('biggerView', bigger);
    document.body.classList.toggle('twocols', twocols);

    // Tell the background about the display-mode change.
    try {
      chrome.runtime.sendMessage({
        msg: 'changeDisplayMode',
        tabId: state.tabId,
        displayMode: displayMode
      });
    } catch (e) {}

    hide(byId('prefsDiv'));
  }

  // ---------------------------------------------------------------------------
  // Section 11 — Reload & Stop search
  // ---------------------------------------------------------------------------

  function wireReloadAndStop() {
    var reload = byId('reloadImageDownloadBatch');
    if (reload) reload.addEventListener('click', startScraping);

    var stop = byId('stopImageSearch');
    if (stop) stop.addEventListener('click', function () {
      state.stopRequested = true;
    });
  }

  // ---------------------------------------------------------------------------
  // Section 12 — Two-column toggle button
  // ---------------------------------------------------------------------------

  function wireTwoColsToggle() {
    var btn = qs('.twoColsPref');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var on = !document.body.classList.contains('twocols');
      document.body.classList.toggle('twocols', on);
      var obj = {};
      obj[STORAGE_KEYS.TWO_COLS] = on;
      try { chrome.storage.local.set(obj); } catch (e) {}
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------------------
  // Section 13 — Area screenshot (side panel only)
  // ---------------------------------------------------------------------------

  /**
   * Wire the .captureSelection button.  Injects captureSelection.js into the
   * active tab, then listens for the returnSelection message.
   */
  function wireCaptureSelection() {
    var btn = qs('.captureSelection');
    if (!btn) return;
    btn.addEventListener('click', function () {
      try {
        chrome.scripting.executeScript({
          target: { tabId: state.tabId, allFrames: false },
          files: ['captureSelection.js']
        });
      } catch (e) {
        // Ignore — button may be hidden in popup mode.
      }
    });
  }

  /** Listen for the returnSelection message from captureSelection.js. */
  function listenForReturnSelection() {
    try {
      chrome.runtime.onMessage.addListener(function (message) {
        if (!message || message.type !== 'returnSelection') return;
        var rect = message.rect;
        if (!rect) return;
        captureAndCropScreenshot(rect);
      });
    } catch (e) {}
  }

  /**
   * Capture the visible tab, crop to the rect (accounting for devicePixelRatio),
   * and add the result as a new image card.
   */
  function captureAndCropScreenshot(rect) {
    try {
      chrome.tabs.captureVisibleTab(undefined, { format: 'png' }, function (dataUrl) {
        if (chrome.runtime.lastError || !dataUrl) return;
        cropDataUrl(dataUrl, rect, function (cropped) {
          if (cropped) addScreenshotCard(cropped);
        });
      });
    } catch (e) {
      // captureVisibleTab may fail in popup mode — silently ignore.
    }
  }

  /** Crop a PNG data: URL to the given rect (in CSS pixels) using canvas. */
  function cropDataUrl(dataUrl, rect, cb) {
    var img = new Image();
    img.onload = function () {
      try {
        var dpr = rect.devicePixelRatio || (window.devicePixelRatio || 1);
        var sx = rect.x * dpr;
        var sy = rect.y * dpr;
        var sw = rect.width * dpr;
        var sh = rect.height * dpr;
        var canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        cb(canvas.toDataURL('image/png'));
      } catch (e) {
        cb(null);
      }
    };
    img.onerror = function () { cb(null); };
    img.src = dataUrl;
  }

  /** Add a screenshot data: URL as a new card in the grid. */
  function addScreenshotCard(dataUrl) {
    var idx = state.allImages.length;
    var img = { url: dataUrl, index: idx, w: 0, h: 0, loaded: false };
    state.allImages.push(img);
    var container = byId('imgsContainer');
    if (container) {
      var card = buildImageCard(img);
      container.appendChild(card);
      probeImageDimensions(img, card);
    }
    showFoundCount(state.allImages.length);
  }

  // ---------------------------------------------------------------------------
  // Section 14 — Misc UI wiring
  // ---------------------------------------------------------------------------

  function wireUI() {
    // Clicking outside the download menu closes it.
    document.addEventListener('click', function (e) {
      var menu = byId('downloadMenu');
      var btn = byId('downloadButton');
      if (!menu || !btn) return;
      if (menu.style.display === 'block' &&
          !menu.contains(e.target) && !btn.contains(e.target)) {
        hide(menu);
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();