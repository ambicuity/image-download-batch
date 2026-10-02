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

  /** Parallel fetch/convert limit for ZIP entries; queued work must not eat its timeout. */
  var ZIP_CONCURRENCY = 6;

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
    DOWNLOAD_OPTIONS_ENABLED: PREF_PREFIX + 'downloadOptionsEnabled',
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
    tabWindowId: null,
    isSidePanel: new URLSearchParams(window.location.search).get('view') === 'sidePanel',
    scrapeId: 0,
    allImages: [],
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
    _pendingDownload: null,
    selectedUrls: new Set(),
    capturePending: false
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

  /** Restore the stylesheet layout; override display:none for menus and dialogs. */
  function show(el) {
    if (!el) return;
    el.style.display = '';
    if (getComputedStyle(el).display === 'none') el.style.display = 'block';
  }

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
    document.body.classList.toggle('sidePanel', state.isSidePanel);
    document.body.classList.toggle('popup', !state.isSidePanel);
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
        state.tabWindowId = tab.windowId;
        connectPort();
        startScraping();
      });
    });

    wireUI();
    wireFilters();
    wireDownloadMenu();
    wireFilterMenus();
    wirePreferences();
    wireSelectAll();
    wireReloadAndStop();
    wireTwoColsToggle();
    wireCaptureSelection();
    wireManyFilesDialog();
    listenForReturnSelection();
    listenForTabChanges();
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
    var scrapeId = ++state.scrapeId;
    state.isScraping = true;

    show(byId('searchingimages'));
    hide(byId('numimagesfound'));
    show(byId('stopImageSearch'));
    show(byId('spinner'));

    var allFrames = !!state._prefAllFrames;
    var target = { tabId: state.tabId, allFrames: allFrames };

    chrome.scripting.executeScript(
      { target: target, files: ['imageScraper.js'] },
      function (results) {
        if (scrapeId !== state.scrapeId) { void chrome.runtime.lastError; return; }
        if (chrome.runtime.lastError) {
          showScrapeError(chrome.runtime.lastError.message || 'Scraping failed');
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

    state.selectedUrls.clear();
    state.allImages = urls.map(function (url, idx) {
      return { url: url, index: idx, w: 0, h: 0, loaded: false };
    });

    renderImages();
    state.allImages.forEach(function (img) {
      if (!img.loaded && !img.probing) probeImageDimensions(img, null);
    });
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
    var downloadButton = byId('downloadButton');
    toggleClass(downloadButton, '--show', n > 0);
    var downloadLabel = downloadButton && qs('label', downloadButton);
    if (downloadLabel) downloadLabel.textContent = chrome.i18n.getMessage('download') || 'Download';

    // Reveal the select-all button once images are present.
    var sa = byId('selectalla');
    if (sa && n > 0) sa.style.visibility = 'visible';
  }

  /** Show an error in place of the spinner. */
  function showScrapeError(msg) {
    showDownloadError(msg || 'Scraping failed.');
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
    sendSelectedImagesToTab();
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
    function markThumbFailed() {
      thumb.classList.add('imgThumb--error');
      thumb.removeAttribute('src');
      thumb.setAttribute('data-error', '1');
    }
    thumb.onerror = function () {
      img.failed = true;
      markThumbFailed();
    };
    thumb.onload = function () {
      var changed = !img.loaded || img.w !== thumb.naturalWidth || img.h !== thumb.naturalHeight;
      img.loaded = true;
      img.w = thumb.naturalWidth || 0;
      img.h = thumb.naturalHeight || 0;
      updateCardMeta(card, img);
      if (changed) refreshDimensionFilters();
    };
    // Known-broken URLs are not re-requested each time the grid re-renders.
    if (img.failed) markThumbFailed(); else thumb.src = img.url;
    card.appendChild(thumb);

    // Selection checkbox.
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'imgCheckbox';
    cb.checked = state.selectedUrls.has(img.url);
    toggleClass(card, 'imgSelected', cb.checked);
    cb.setAttribute('aria-label', 'Select image');
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () {
      if (cb.checked) state.selectedUrls.add(img.url);
      else state.selectedUrls.delete(img.url);
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
      if (cb.checked) state.selectedUrls.add(img.url);
      else state.selectedUrls.delete(img.url);
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
    if (img.loaded || img.probing || img.failed) return;
    img.probing = true;
    var probe = new Image();
    probe.onload = function () {
      img.loaded = true;
      img.w = probe.naturalWidth || 0;
      img.h = probe.naturalHeight || 0;
      updateCardMeta(card, img);
      refreshDimensionFilters();
    };
    probe.onerror = function () { img.probing = false; img.failed = true; };
    probe.src = img.url;
  }

  // Re-render once per burst of dimension discoveries so size/layout and pixel sort settle.
  var refreshDimensionFilters = debounce(function () { renderImages(); }, 50);

  /** Update the meta (dimensions / type) text inside a card. */
  function updateCardMeta(card, img) {
    if (!card) return;
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
      var m = url.match(/^data:image\/([a-z0-9.+-]+)(?:;|,)/i);
      if (m) return m[1].split('+')[0].toUpperCase();
      return 'DATA';
    }
    try {
      // Only the last path segment carries an extension ("/v1.2/photo" has none).
      var name = tryFilename(url);
      var dot = name.lastIndexOf('.');
      if (dot === -1) return '';
      var ext = name.slice(dot + 1).toUpperCase();
      // Normalise aliases so type filters and conversion match: JPEG -> JPG, TIF -> TIFF.
      if (ext === 'JPEG') return 'JPG';
      return ext === 'TIF' ? 'TIFF' : ext;
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

    ['minwidthinput', 'minheightinput'].forEach(function (id) {
      var input = byId(id);
      if (!input) return;
      input.addEventListener('input', function () {
        state.filters.size = 'custom';
        state.filters.minWidth = Math.max(0, intOrZero(byId('minwidthinput').value));
        state.filters.minHeight = Math.max(0, intOrZero(byId('minheightinput').value));
        qsa('[sizeconf]').forEach(function (item) {
          item.classList.toggle('selected', item.getAttribute('sizeconf') === 'custom');
        });
        renderImages();
        showClearFilters();
      });
    });

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
    var mw = byId('minwidthinput'); if (mw) mw.value = 0;
    var mh = byId('minheightinput'); if (mh) mh.value = 0;
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
      var url = c.getAttribute('imgsrc');
      if (anyUnselected) state.selectedUrls.add(url);
      else state.selectedUrls.delete(url);
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
      btn.addEventListener('click', function (event) {
        if (menu.contains(event.target)) return;
        var open = menu.style.display === 'block';
        if (open) { hide(menu); btn.setAttribute('aria-expanded', 'false'); }
        else { show(menu); btn.setAttribute('aria-expanded', 'true'); }
      });
      btn.addEventListener('keydown', function (e) {
        if (e.target === btn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); btn.click(); }
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
    obj[STORAGE_KEYS.DOWNLOAD_OPTIONS_ENABLED] = !!(o.saveFolderName || o.saveFileName || o.convertFrom || o.saveFileAs !== 'SYSTEM_NAME');
    setChecked('downloadseparatefolder', obj[STORAGE_KEYS.DOWNLOAD_OPTIONS_ENABLED]);
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

    var options = Object.assign({}, state.downloadOptions);
    var convFrom = options.convertFrom;
    var convTo = options.convertTo;

    urls.forEach(function (url, idx) {
      if (shouldConvert(url, convFrom, convTo)) {
        convertImage(url, convTo, function (dataUrl) {
          if (dataUrl) downloadDataUrl(dataUrl, url, idx, options);
          else downloadSingleImage(url, idx, options);
        });
      } else {
        downloadSingleImage(url, idx, options);
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
  function downloadSingleImage(url, index, options) {
    requestImageDownload(url, url, index, options);
  }

  function requestImageDownload(url, sourceUrl, index, options) {
    chrome.runtime.sendMessage({
      msg: 'downloadImage', url: url, sourceUrl: sourceUrl, index: (index || 0) + 1,
      downloadOptions: Object.assign({}, options || state.downloadOptions)
    }, function (response) {
      var error = chrome.runtime.lastError;
      if (error || !response || !response.success) {
        showDownloadError(error ? error.message : (response && response.error) || 'Download failed');
      }
    });
  }

  function showDownloadError(message) {
    var container = byId('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4000);
  }

  /**
   * Convert an image via canvas to the target MIME type and call back with a
   * data: URL (or null on failure).
   */
  function convertImage(url, targetFormat, cb) {
    var done = false;
    var timeout = setTimeout(function () { finish(null); }, 30000);
    function finish(result) {
      if (done) return;
      done = true; clearTimeout(timeout); cb(result);
    }
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        var ctx = canvas.getContext('2d');
        // JPEG has no alpha channel: transparent pixels would otherwise turn black.
        if (targetFormat === 'jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);
        var mime = 'image/' + targetFormat;
        var dataUrl = canvas.toDataURL(mime, 0.92);
        finish(dataUrl.indexOf('data:' + mime + ';') === 0 ? dataUrl : null);
      } catch (e) {
        // Canvas tainted (CORS) — fall back to raw download.
        finish(null);
      }
    };
    img.onerror = function () { finish(null); };
    img.src = url;
  }

  /** Download converted data directly so the worker retains its source and index. */
  function downloadDataUrl(dataUrl, originalUrl, index, options) {
    requestImageDownload(dataUrl, originalUrl, index, options);
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
        bytes = unescape(encodeURIComponent(raw).replace(/%25/g, '%'));
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
    var options = Object.assign({}, state.downloadOptions);
    var convTo = options.convertTo || 'jpeg';
    convertImage(url, convTo, function (dataUrl) {
      if (dataUrl) downloadDataUrl(dataUrl, url, 0, options);
      else downloadSingleImage(url, 0, options);
    });
  }

  /**
   * Build a ZIP archive from the given URLs and trigger a single download.
   * Dynamically loads 733.js (which defines globalThis.JSZip) if needed.
   */
  var zipLibraryPromise = null;

  // The vendored file is a webpack chunk, not a standalone UMD script.
  function getZipConstructor() {
    if (typeof globalThis.JSZip === 'function') return globalThis.JSZip;
    var chunks = globalThis.webpackChunkimgdl || [];
    for (var i = 0; i < chunks.length; i++) {
      var factory = chunks[i] && chunks[i][1] && chunks[i][1][733];
      if (typeof factory !== 'function') continue;
      var module = { exports: {} };
      factory(module, module.exports, { g: globalThis });
      if (typeof module.exports === 'function') {
        globalThis.JSZip = module.exports; return module.exports;
      }
    }
    return null;
  }

  function loadZipLibrary() {
    var Zip = getZipConstructor();
    if (Zip) return Promise.resolve(Zip);
    if (zipLibraryPromise) return zipLibraryPromise;
    zipLibraryPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var timeout = setTimeout(function () { fail('ZIP library loading timed out.'); }, 10000);
      function fail(message) {
        clearTimeout(timeout); script.remove(); reject(new Error(message));
      }
      script.src = '733.js'; script.async = true;
      script.onload = function () {
        clearTimeout(timeout);
        try {
          var Zip = getZipConstructor();
          if (!Zip) { fail('ZIP library is unavailable.'); return; }
          resolve(Zip);
        } catch (error) { fail(error.message || 'Could not initialize the ZIP library.'); }
      };
      script.onerror = function () { fail('Could not load the ZIP library.'); };
      document.head.appendChild(script);
    }).catch(function (error) { zipLibraryPromise = null; throw error; });
    return zipLibraryPromise;
  }

  function blobFromUrl(url) {
    return new Promise(function (resolve) { fetchAsBlob(url, resolve); });
  }

  function getZipEntry(url, index, options) {
    return new Promise(function (resolve) {
      function finish(blob, converted) {
        if (!blob) { resolve(null); return; }
        var ext = defaultExt(url);
        if (converted) ext = options.convertTo === 'jpeg' ? 'jpg' : options.convertTo;
        else if (/^image\//i.test(blob.type)) {
          var mimeExt = blob.type.split('/')[1].split(';')[0].split('+')[0].toLowerCase();
          if (mimeExt === 'jpeg') mimeExt = 'jpg';
          if (IMAGE_EXTENSIONS.indexOf(mimeExt) !== -1) ext = mimeExt;
        }
        var original = 'image';
        try {
          var parsed = new URL(url);
          if (/^https?:$/.test(parsed.protocol)) original = decodeURIComponent(parsed.pathname.split('/').pop()) || original;
        } catch (e) {}
        original = original.replace(/\.[^.]+$/, '');
        var filename;
        if (options.saveFileAs === 'CUSTOM_NAME') {
          filename = applyFilenameTokens(options.saveFileName, { name: original, ext: ext, index: index + 1, url: url });
        } else if (options.saveFileAs === 'ORIGINAL_FILE_NAME') filename = original + '.' + ext;
        else filename = 'imgi_' + (index + 1) + '_' + original + '.' + ext;
        var folder = options.saveFolderName;
        if (folder === 'basedonurl') {
          try { folder = new URL(url).hostname; } catch (e) { folder = ''; }
        }
        filename = sanitizeFilename(filename);
        if (folder) filename = sanitizeFilename(folder) + '/' + filename;
        resolve({ filename: filename, blob: blob });
      }
      function fetchOriginal() { blobFromUrl(url).then(function (blob) { finish(blob, false); }); }
      if (shouldConvert(url, options.convertFrom, options.convertTo)) {
        convertImage(url, options.convertTo, function (dataUrl) {
          if (dataUrl) finish(dataUrlToBlob(dataUrl), true); else fetchOriginal();
        });
      } else fetchOriginal();
    });
  }

  /** Run fn over items with at most `limit` pending promises; results keep input order. */
  function mapWithConcurrency(items, limit, fn) {
    var results = new Array(items.length);
    var next = 0;
    function runNext() {
      if (next >= items.length) return Promise.resolve();
      var index = next++;
      return Promise.resolve()
        .then(function () { return fn(items[index], index); })
        .catch(function () { return null; })
        .then(function (value) { results[index] = value; return runNext(); });
    }
    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) runners.push(runNext());
    return Promise.all(runners).then(function () { return results; });
  }

  function downloadAsZip(urls) {
    if (!urls.length) return Promise.resolve();
    var options = Object.assign({}, state.downloadOptions);
    return loadZipLibrary().then(function (Zip) {
      return mapWithConcurrency(urls, ZIP_CONCURRENCY, function (url, index) { return getZipEntry(url, index, options); }).then(function (entries) {
        var zip = new Zip(), failed = 0, used = Object.create(null);
        entries.forEach(function (entry) {
          if (!entry) { failed++; return; }
          var filename = entry.filename;
          var dot = filename.lastIndexOf('.'), base = dot < 0 ? filename : filename.slice(0, dot), ext = dot < 0 ? '' : filename.slice(dot);
          var duplicate = 1;
          while (used[filename]) filename = base + ' (' + (++duplicate) + ')' + ext;
          used[filename] = true; zip.file(filename, entry.blob);
        });
        if (failed === entries.length) throw new Error('No images could be fetched. ZIP was not created.');
        if (failed) showDownloadError(failed + ' image(s) could not be fetched and were omitted from the ZIP.');
        return zip.generateAsync({ type: 'blob' });
      });
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var zipName = options.saveFolderName && options.saveFolderName !== 'basedonurl' ? sanitizeFilename(options.saveFolderName) : 'images';
      chrome.downloads.download({ url: url, filename: zipName + '.zip', conflictAction: 'uniquify' }, function () {
        if (chrome.runtime.lastError) showDownloadError(chrome.runtime.lastError.message);
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      });
    }).catch(function (error) { showDownloadError(error.message || 'ZIP download failed.'); });
  }

  /** Fetch successful responses only; an error document is never an image entry. */
  function fetchAsBlob(url, cb) {
    if (url.indexOf('data:') === 0) { cb(dataUrlToBlob(url)); return; }
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 30000);
    Promise.resolve().then(function () { return fetch(url, { mode: 'cors', signal: controller.signal }); })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.blob();
      }).then(function (blob) { clearTimeout(timeout); cb(blob); })
      .catch(function () { clearTimeout(timeout); cb(null); });
  }

  function defaultExt(url) {
    var ext = getExtensionFromUrl(url).toLowerCase();
    if (IMAGE_EXTENSIONS.indexOf(ext) !== -1) return ext === 'jpeg' ? 'jpg' : ext;
    return 'jpg';
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
    toggleClass(byId('container'), 'bigger', state._prefBiggerView && !state.isSidePanel);

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

    populateDownloadControls();
    var enabled = cfg[STORAGE_KEYS.DOWNLOAD_OPTIONS_ENABLED];
    if (enabled == null) enabled = !!(state.downloadOptions.saveFolderName || state.downloadOptions.saveFileName ||
      state.downloadOptions.saveFileAs !== 'SYSTEM_NAME' || state.downloadOptions.convertFrom);
    setChecked('downloadseparatefolder', enabled);
    toggleDownloadPreferences();

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
    // A saved size filter hides images on open; offer the Clear control for it.
    showClearFilters();
  }

  function populateDownloadControls() {
    var o = state.downloadOptions;
    [['savefoldername', 'savefoldernamePrefs', o.saveFolderName],
     ['saveFileAs', 'saveFileAsPref', o.saveFileAs],
     ['saveFileName', 'saveFileNamePref', o.saveFileName],
     ['convertFrom', 'convertFromPrefs', o.convertFrom],
     ['convertTo', 'convertToPrefs', o.convertTo]].forEach(function (entry) {
      setVal(entry[0], entry[2]); setVal(entry[1], entry[2]);
    });
    setChecked('downloadAsZip', o.downloadAsZip);
  }

  function toggleDownloadPreferences() {
    var cb = byId('downloadseparatefolder');
    var options = byId('downloadocationcontainer');
    if (cb && cb.checked) show(options); else hide(options);
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
        populateDownloadControls();
        setChecked('displayInSidePanel', state._prefDisplayMode === 'sidePanel');
        setChecked('biggerview', state._prefBiggerView);
        setChecked('donotbother', state._prefDoNotBother);
        setChecked('allframes', state._prefAllFrames);
        setChecked('twocols', state._prefTwoCols);
        toggleDownloadPreferences();
        show(prefsDiv);
      });
    }
    var downloadOptionsCb = byId('downloadseparatefolder');
    if (downloadOptionsCb) downloadOptionsCb.addEventListener('change', toggleDownloadPreferences);
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
    var enabled = !!(byId('downloadseparatefolder') && byId('downloadseparatefolder').checked);
    obj[STORAGE_KEYS.DOWNLOAD_OPTIONS_ENABLED] = enabled;
    var o = state.downloadOptions;
    o.saveFolderName = enabled ? byId('savefoldernamePrefs').value.trim() : '';
    o.saveFileAs = enabled ? byId('saveFileAsPref').value : 'SYSTEM_NAME';
    o.saveFileName = enabled ? byId('saveFileNamePref').value.trim() : '';
    o.convertFrom = enabled ? byId('convertFromPrefs').value : '';
    o.convertTo = enabled ? byId('convertToPrefs').value : 'jpeg';
    persistDownloadOptions();
    populateDownloadControls();
    try { chrome.storage.local.set(obj); } catch (e) {}

    // Apply visual changes immediately.
    toggleClass(byId('container'), 'bigger', bigger && !state.isSidePanel);
    document.body.classList.toggle('twocols', twocols);

    // Tell the background about the display-mode change.
    try {
      chrome.runtime.sendMessage({
        msg: 'changeDisplayMode',
        tabId: state.tabId,
        displayMode: displayMode
      }, function (response) {
        var error = chrome.runtime.lastError;
        if (error || !response || !response.success) showDownloadError((error && error.message) || 'Could not change display mode.');
        else if (displayMode === 'sidePanel' && !state.isSidePanel) showDownloadError('Side panel enabled. Click the extension toolbar icon to open it.');
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
    // executeScript cannot be cancelled: invalidate the scan so its late
    // result is ignored, and end the search UI immediately.
    if (stop) stop.addEventListener('click', function () {
      if (!state.isScraping) return;
      state.scrapeId++;
      finishScraping([]);
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
      state._prefTwoCols = on;
      setChecked('twocols', on);
      var obj = {};
      obj[STORAGE_KEYS.TWO_COLS] = on;
      try { chrome.storage.local.set(obj); } catch (e) {}
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------------------
  // Section 13 — Area screenshot (side panel only)
  // ---------------------------------------------------------------------------

  function listenForTabChanges() {
    if (!state.isSidePanel) return;
    function refreshTab() {
      getActiveTab(function (tab) {
        if (!tab || tab.windowId !== state.tabWindowId) return;
        if (state.port && state.port.disconnect) state.port.disconnect();
        state.tabId = tab.id; state.tabUrl = tab.url || '';
        state.isScraping = false; state.scrapeId++; state.capturePending = false;
        connectPort(); startScraping();
      });
    }
    chrome.tabs.onActivated.addListener(function (info) {
      if (info.windowId === state.tabWindowId) refreshTab();
    });
    chrome.tabs.onUpdated.addListener(function (tabId, change) {
      if (tabId === state.tabId && change.status === 'complete') refreshTab();
    });
  }

  /**
   * Wire the .captureSelection button.  Injects captureSelection.js into the
   * active tab, then listens for the returnSelection message.
   */
  function wireCaptureSelection() {
    var btn = qs('.captureSelection');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!state.isSidePanel || state.tabId < 0) return;
      state.capturePending = true;
      try {
        chrome.scripting.executeScript({
          target: { tabId: state.tabId, allFrames: false },
          files: ['captureSelection.js']
        }, function () {
          if (chrome.runtime.lastError) {
            state.capturePending = false; showDownloadError(chrome.runtime.lastError.message);
          }
        });
      } catch (e) {
        state.capturePending = false; showDownloadError(e.message || 'Could not start area capture.');
      }
    });
  }

  /** Listen for the returnSelection message from captureSelection.js. */
  function listenForReturnSelection() {
    try {
      chrome.runtime.onMessage.addListener(function (message, sender) {
        if (!message || message.type !== 'returnSelection' || !state.capturePending) return;
        if (!sender.tab || sender.tab.id !== state.tabId || sender.frameId !== 0) return;
        var rect = message.rect;
        if (!rect || !['x', 'y', 'width', 'height'].every(function (key) { return Number.isFinite(rect[key]); }) || rect.width <= 0 || rect.height <= 0) return;
        state.capturePending = false;
        captureAndCropScreenshot(rect);
      });
    } catch (e) {}
  }

  /**
   * Capture the visible tab, crop to the rect (accounting for devicePixelRatio),
   * and add the result as a new image card.
   */
  function captureAndCropScreenshot(rect) {
    var tabId = state.tabId;
    getActiveTab(function (tab) {
      if (!tab || tab.id !== tabId || tab.windowId !== state.tabWindowId) return;
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, function (dataUrl) {
        if (chrome.runtime.lastError || !dataUrl) {
          var error = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Screenshot capture failed.';
          if (/activeTab|<all_urls>/.test(error)) error = 'Click the extension toolbar icon on this tab, then retry Capture selection.';
          showDownloadError(error); return;
        }
        getActiveTab(function (active) {
          if (!active || active.id !== tabId || state.tabId !== tabId) return;
          cropDataUrl(dataUrl, rect, function (cropped) { if (cropped) addScreenshotCard(cropped); });
        });
      });
    });
  }

  /** Crop a PNG data: URL to the given rect (in CSS pixels) using canvas. */
  function cropDataUrl(dataUrl, rect, cb) {
    var img = new Image();
    img.onload = function () {
      try {
        var scaleX = rect.viewportWidth > 0 ? img.naturalWidth / rect.viewportWidth : (rect.devicePixelRatio || 1);
        var scaleY = rect.viewportHeight > 0 ? img.naturalHeight / rect.viewportHeight : (rect.devicePixelRatio || 1);
        var sx = Math.max(0, Math.round(rect.x * scaleX));
        var sy = Math.max(0, Math.round(rect.y * scaleY));
        var sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * scaleX));
        var sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * scaleY));
        if (sw <= 0 || sh <= 0) { cb(null); return; }
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
    renderImages();
    probeImageDimensions(img, null);
    showFoundCount(state.allImages.length);
  }

  // ---------------------------------------------------------------------------
  // Section 14 — Misc UI wiring
  // ---------------------------------------------------------------------------

  function wireFilterMenus() {
    qsa('.filters > div').forEach(function (host) {
      var menu = qs('.selectMenu', host);
      if (!menu || host.classList.contains('clearFilters')) return;
      host.addEventListener('click', function (e) {
        if (menu.contains(e.target)) return;
        var open = menu.classList.contains('--active');
        qsa('.filters .selectMenu').forEach(function (m) { m.classList.remove('--active'); });
        menu.classList.toggle('--active', !open);
        host.setAttribute('aria-expanded', String(!open));
      });
      document.addEventListener('click', function (e) {
        if (!host.contains(e.target)) {
          menu.classList.remove('--active');
          host.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

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
