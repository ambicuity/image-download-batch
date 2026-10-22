// Run with: node --test docs/superpowers/tests/bug-regressions-3.test.cjs
//
// Third audit pass (R1–R10). Each test reproduces one concrete defect against the
// shipped controllers using VM-loaded real source and Chrome/DOM doubles.
//
// R1  per-card downloads always use index 1
// R2  selections hidden by a filter are dropped, and an empty visible selection
//     falls back to downloading every visible image
// R3  filter dropdowns stay open after an option is picked
// R4  context-menu downloads ignore every download preference (naming/subfolder)
// R5  context-menu downloads bypass the many-files confirmation
// R6  the worker never falls back to its stored download options
// R7  the ZIP archive name ignores the naming preferences and nests the subfolder twice
// R8  "Save download options" silently rewrites the "Specify Download Options" preference
// R9  the Preferences hotkey badge is hardcoded to the macOS shortcut
// R10 full-resolution (rewritten) URLs are never highlighted on the page
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));

/* -------------------------------------------------------------------------- *
 * DOM double
 * -------------------------------------------------------------------------- */

function matchesSimple(el, sel) {
  sel = String(sel || '').trim();
  if (!sel) return false;
  const notRe = /:not\(([^)]+)\)/g;
  const negatives = [];
  let m;
  while ((m = notRe.exec(sel)) !== null) negatives.push(m[1]);
  const base = sel.replace(notRe, '').trim();
  let ok = true;
  if (base) {
    if (base.startsWith('#')) ok = el.getAttribute('id') === base.slice(1);
    else if (base.startsWith('.')) ok = base.slice(1).split('.').filter(Boolean).every(c => el.classes.has(c));
    else if (base.startsWith('[')) {
      const am = base.match(/^\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]$/);
      if (!am) ok = false;
      else if (am[2] === undefined) ok = el.hasAttribute(am[1]);
      else ok = el.getAttribute(am[1]) === am[2];
    } else ok = el.tagName === base.toUpperCase();
  }
  for (const neg of negatives) if (matchesSimple(el, neg)) { ok = false; break; }
  return ok;
}

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.events = {};
    this.value = '';
    this.textContent = '';
    this.parent = null;
    this.classes = new Set();
    this.classList = {
      add: c => this.classes.add(c),
      remove: c => this.classes.delete(c),
      contains: c => this.classes.has(c),
      toggle: (c, on = !this.classes.has(c)) => { if (on) this.classes.add(c); else this.classes.delete(c); }
    };
  }
  set className(v) { this.classes = new Set(String(v).split(' ').filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(el) { el.parent = this; this.children.push(el); return el; }
  removeChild(el) { this.children = this.children.filter(c => c !== el); el.parent = null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  get parentNode() { return this.parent; }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  removeEventListener() {}
  fire(k, extra = {}) {
    (this.events[k] || []).slice().forEach(fn => fn({
      target: this, preventDefault() {}, stopPropagation() {}, ...extra
    }));
  }
  contains(el) { return el === this || this.children.some(c => c.contains(el)); }
  closest(sel) { let n = this; while (n) { if (matchesSimple(n, sel)) return n; n = n.parent; } return null; }
  querySelectorAll(sel) {
    return this.children.flatMap(c => [c, ...c.querySelectorAll(sel)]).filter(c => matchesSimple(c, sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/* -------------------------------------------------------------------------- *
 * Popup harness
 * -------------------------------------------------------------------------- */

const POPUP_API = 'state, show, renderImages, buildImageCard, getSelectedOrAllUrls, triggerDownload, ' +
  'runDownloads, downloadSingleImage, convertAndDownloadSingle, wireFilters, wireFilterMenus, ' +
  'sendSelectedImagesToTab, applyPreferences, persistDownloadOptions, init';

function popupApi() {
  return '{ state, show, renderImages, buildImageCard, getSelectedOrAllUrls, triggerDownload, ' +
    'runDownloads, downloadSingleImage, convertAndDownloadSingle, wireFilters, wireFilterMenus, ' +
    'sendSelectedImagesToTab, applyPreferences, persistDownloadOptions, init, ' +
    'downloadAsZip, zipArchiveName, getZipEntry, ' +
    'updateHotkeyBadge: (typeof updateHotkeyBadge === "function" ? updateHotkeyBadge : null) }';
}

function popup3() {
  const ids = {};
  const mk = (id, tag = 'div') => { const e = new El(tag); e.setAttribute('id', id); ids[id] = e; return e; };
  ['imgsContainer', 'downloadButton', 'downloadMenu', 'prefsDiv', 'manyfiles', 'manyfilesnum',
    'manyfilesdownload', 'manyfilescancel', 'donotbotherme', 'minwidthinput', 'minheightinput',
    'selectalla', 'container', 'downloadseparatefolder', 'downloadocationcontainer', 'savefoldername',
    'savefoldernamePrefs', 'saveFileAs', 'saveFileAsPref', 'saveFileName', 'saveFileNamePref',
    'convertFrom', 'convertFromPrefs', 'convertTo', 'convertToPrefs', 'downloadAsZip', 'stopImageSearch',
    'filterbyurlinput', 'sizeTab', 'sortTab', 'openHotKeyPrefs', 'reloadImageDownloadBatch',
    'numimagesfound', 'searchingimages', 'spinner', 'toastContainer'].forEach(id => mk(id));

  ids.downloadButton.appendChild(ids.downloadMenu);

  // Filter menus, mirroring popup.html.
  const sizeMenu = new El(); sizeMenu.className = 'selectMenu sizeMenu';
  const sizeItems = ['any', 'small', 'medium', 'large', 'custom'].map(v => {
    const it = new El(); it.setAttribute('sizeconf', v); it.className = v === 'any' ? 'selected' : ''; sizeMenu.appendChild(it); return it;
  });
  const saveSize = new El(); saveSize.setAttribute('savesize', 'true'); sizeMenu.appendChild(saveSize);
  ids.sizeTab.appendChild(sizeMenu);

  const typeHost = new El(); const typeMenu = new El(); typeMenu.className = 'selectMenu typeMenu';
  ['any', 'JPG', 'GIF', 'PNG'].forEach(v => { const it = new El(); it.setAttribute('typeconf', v); typeMenu.appendChild(it); });
  typeHost.appendChild(typeMenu);

  const layoutHost = new El(); const layoutMenu = new El(); layoutMenu.className = 'selectMenu layoutMenu';
  ['any', 'square'].forEach(v => { const it = new El(); it.setAttribute('layoutconf', v); layoutMenu.appendChild(it); });
  layoutHost.appendChild(layoutMenu);

  const urlHost = new El(); const urlMenu = new El(); urlMenu.className = 'selectMenu';
  urlMenu.appendChild(ids.filterbyurlinput); urlHost.appendChild(urlMenu);

  const sortMenu = new El(); sortMenu.className = 'selectMenu sortMenu';
  ['pixels', 'index'].forEach(v => { const it = new El(); it.setAttribute('sortconf', v); sortMenu.appendChild(it); });
  ids.sortTab.appendChild(sortMenu);

  const clearFilters = new El(); clearFilters.className = 'clearFilters';

  const cards = () => ids.imgsContainer.querySelectorAll('.imgContainer');
  const selectedCards = () => cards().filter(c => c.classes.has('imgSelected'));

  const document = new El();
  document.readyState = 'loading';
  document.body = new El(); document.head = new El();
  document.getElementById = id => ids[id] || null;
  document.createElement = tag => new El(tag);
  const table = {
    '.imgContainer': () => cards(),
    '.imgContainer:not(.excluded)': () => cards(),
    '.imgContainer.imgSelected:not(.excluded)': () => selectedCards(),
    '.filters > div': () => [ids.sizeTab, typeHost, layoutHost, urlHost, ids.sortTab],
    '.clearFilters': () => [clearFilters],
    '[sizeconf]': () => sizeItems,
    '[typeconf]': () => typeMenu.querySelectorAll('[typeconf]'),
    '[layoutconf]': () => layoutMenu.querySelectorAll('[layoutconf]'),
    '[sortconf]': () => sortMenu.querySelectorAll('[sortconf]'),
    '.filters .selectMenu': () => [sizeMenu, typeMenu, layoutMenu, urlMenu, sortMenu]
  };
  document.querySelectorAll = sel => (table[sel] ? table[sel]() : []);
  document.querySelector = sel => document.querySelectorAll(sel)[0] || null;

  const messages = [], downloads = [], probes = [], timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document, URL, URLSearchParams, Blob, Set, Uint8Array, TextEncoder, AbortController, atob, unescape,
    encodeURIComponent, Date, Math, JSON, Promise,
    window: { location: { search: '' } },
    getComputedStyle: () => ({ display: 'none' }),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    Image: function () { probes.push(this); },
    chrome: {
      runtime: {
        sendMessage: (m, cb) => { messages.push(m); if (cb) cb({ success: true }); },
        onMessage: { addListener() {} },
        connect: () => ({ disconnect() {} })
      },
      tabs: { sendMessage() {}, query: (_, cb) => cb([]) },
      scripting: { executeScript: (_, cb) => cb([]) },
      storage: { local: { get: (_, cb) => cb({}), set() {} }, session: { get: (_, cb) => cb({}), set() {} } },
      downloads: { download: (opts, cb) => { downloads.push(opts); if (cb) cb(downloads.length); } },
      i18n: { getMessage: () => '' },
      commands: { getAll: cb => cb([]) }
    }
  });
  vm.runInContext(source('filenameTokens.js'), context);
  vm.runInContext(source('sanitize.js'), context);
  const code = source('popup.js').replace('  // Boot\n',
    '  // Boot\n globalThis.api = ' + popupApi() + ';\n');
  vm.runInContext(code, context);
  return {
    ...context.api, context, document, ids, messages, downloads, probes, sizeItems, sizeMenu,
    cards, selectedCards, clearFilters,
    flush: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn()); }
  };
}

/* -------------------------------------------------------------------------- *
 * Worker harness
 * -------------------------------------------------------------------------- */

function worker3(storedPrefs = {}) {
  const downloads = [];
  let message;
  const store = Object.assign({}, storedPrefs);
  const chrome = {
    runtime: {
      id: 'test', lastError: undefined,
      onMessage: { addListener: fn => { message = fn; } },
      onConnect: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach(k => { if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k]; });
          cb(out);
        },
        set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); }
      },
      sync: { get: (_, cb) => cb({}), clear: cb => cb() }
    },
    action: { setPopup() {}, onClicked: { addListener() {} } },
    sidePanel: { setOptions: () => Promise.resolve(), setPanelBehavior: () => Promise.resolve(), open: () => Promise.resolve() },
    downloads: { download: (opts, cb) => { downloads.push(opts); if (cb) cb(downloads.length); } }
  };
  const context = vm.createContext({ chrome, URL, Date, TextEncoder, TextDecoder, Promise, console });
  context.importScripts = file => vm.runInContext(source(file), context);
  vm.runInContext(source('filenameTokens.js'), context);
  if (exists('downloadNaming.js')) vm.runInContext(source('downloadNaming.js'), context);
  vm.runInContext(source('background.js'), context);
  return {
    context, downloads, store,
    send: m => new Promise(resolve => message(m, {}, resolve)),
    sendAsync: (m, sender = {}) => new Promise(resolve => message(m, sender, resolve))
  };
}

/* -------------------------------------------------------------------------- *
 * Context-menu harness
 * -------------------------------------------------------------------------- */

function menu3(opts = {}) {
  const images = opts.images || ['https://cdn.test/photo.jpg'];
  const prefs = opts.prefs || {};
  const downloads = [];
  const session = {};
  let clickHandler, menuCreated, uiOpened = 0;
  let installedListener, startupListener;

  const chrome = {
    contextMenus: {
      removeAll(cb) { if (cb) cb(); },
      create(o, cb) { menuCreated = o; if (cb) cb(); },
      onClicked: { addListener(fn) { clickHandler = fn; } }
    },
    runtime: {
      onInstalled: { addListener(fn) { installedListener = fn; } },
      onStartup: { addListener(fn) { startupListener = fn; } },
      getURL: p => 'chrome-extension://test/' + p
    },
    scripting: {
      executeScript(o, cb) { if (cb) cb([{ result: { images } }]); }
    },
    downloads: {
      download(o, cb) { downloads.push(o); if (cb) cb(downloads.length); }
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach(k => { if (Object.prototype.hasOwnProperty.call(prefs, k)) out[k] = prefs[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(prefs, obj); if (cb) cb(); }
      },
      session: {
        get(keys, cb) {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach(k => { if (Object.prototype.hasOwnProperty.call(session, k)) out[k] = session[k]; });
          cb(out);
        },
        set(obj, cb) { Object.assign(session, obj); if (cb) cb(); },
        remove(keys, cb) {
          (Array.isArray(keys) ? keys : [keys]).forEach(k => delete session[k]);
          if (cb) cb();
        }
      }
    },
    action: { openPopup() { uiOpened++; return Promise.resolve(); } },
    sidePanel: { open() { uiOpened++; return Promise.resolve(); } }
  };
  const context = vm.createContext({ chrome, URL, Promise, console, setTimeout, clearTimeout, AbortController, TextEncoder, TextDecoder });
  vm.runInContext(source('filenameTokens.js'), context);
  vm.runInContext(source('sanitize.js'), context);
  if (exists('downloadNaming.js')) vm.runInContext(source('downloadNaming.js'), context);
  vm.runInContext(source('contextMenu.js'), context);
  // The menu is registered on install/startup.
  if (installedListener) installedListener({ reason: 'install' });
  return {
    context, downloads, session, prefs, get menuCreated() { return menuCreated; },
    get uiOpened() { return uiOpened; },
    click: () => clickHandler({ menuItemId: menuCreated && menuCreated.id }, { id: 42 })
  };
}

/** Let the pending promise callbacks of the harness settle. */
function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

/* -------------------------------------------------------------------------- *
 * R1 — per-card downloads always use index 1
 * -------------------------------------------------------------------------- */

test('R1: a per-card download uses that image’s page index, not a constant 1', () => {
  const p = popup3();
  p.state.allImages = [{ url: 'https://cdn.test/photo.jpg', index: 5, loaded: true, w: 100, h: 100 }];
  p.renderImages();
  const card = p.cards()[0];
  const buttons = card.querySelectorAll('.imgAction');
  const downloadBtn = buttons.find(b => b.textContent === 'Download');
  assert.ok(downloadBtn, 'card has a Download action');
  downloadBtn.fire('click');
  const request = p.messages.find(m => m.msg === 'downloadImage');
  assert.ok(request, 'a download request was sent');
  assert.equal(request.index, 6, 'the image at page index 5 must be downloaded as #6');
});

/* -------------------------------------------------------------------------- *
 * R2 — filtered-out selections
 * -------------------------------------------------------------------------- */

test('R2: a selected image hidden by a filter is still downloaded, and an empty visible selection never falls back to "all visible"', () => {
  const p = popup3();
  p.state.allImages = [
    { url: 'https://cdn.test/a.jpg', index: 0, loaded: true, w: 10, h: 10 },
    { url: 'https://cdn.test/b.jpg', index: 1, loaded: true, w: 10, h: 10 }
  ];
  p.renderImages();

  // Select only B.
  const bCard = p.cards().find(c => c.getAttribute('imgsrc') === 'https://cdn.test/b.jpg');
  const cb = bCard.querySelector('.imgCheckbox');
  cb.checked = true;
  cb.fire('change');
  assert.deepEqual([...p.state.selectedUrls], ['https://cdn.test/b.jpg']);

  // Hide B with the URL filter; only A stays on screen.
  p.state.filters.url = 'a.jpg';
  p.renderImages();
  assert.equal(p.cards().length, 1, 'B is filtered out of the grid');

  p.triggerDownload();
  const requests = p.messages.filter(m => m.msg === 'downloadImage');
  assert.equal(requests.length, 1, 'exactly one image is downloaded');
  assert.equal(requests[0].url, 'https://cdn.test/b.jpg', 'the explicitly selected image is downloaded');
});

/* -------------------------------------------------------------------------- *
 * R3 — filter dropdowns stay open
 * -------------------------------------------------------------------------- */

test('R3: picking a filter option closes the dropdown', () => {
  const p = popup3();
  p.wireFilters();
  p.wireFilterMenus();

  p.ids.sizeTab.fire('click', { target: p.ids.sizeTab });
  assert.equal(p.sizeMenu.classes.has('--active'), true, 'dropdown opened');

  const large = p.sizeItems.find(i => i.getAttribute('sizeconf') === 'large');
  large.fire('click', { target: large });
  assert.equal(p.state.filters.size, 'large', 'the option was applied');
  assert.equal(p.sizeMenu.classes.has('--active'), false, 'the dropdown closed after choosing an option');
});

/* -------------------------------------------------------------------------- *
 * R4 — context-menu downloads ignore the download preferences
 * -------------------------------------------------------------------------- */

test('R4: context-menu downloads honour the saved naming and subfolder preferences', async () => {
  const m = menu3({
    images: ['https://cdn.test/photo.jpg'],
    prefs: {
      imgdl_savefileas: 'CUSTOM_NAME',
      imgdl_savefilename: '{index}-{name}',
      imgdl_savefoldername: 'photos'
    }
  });
  m.click();
  await settle();
  assert.equal(m.downloads.length, 1, 'one image downloaded');
  assert.equal(m.downloads[0].filename, 'photos/1-photo.jpg',
    'the saved custom-name template and subfolder are applied');
});

/* -------------------------------------------------------------------------- *
 * R5 — context-menu downloads bypass the many-files confirmation
 * -------------------------------------------------------------------------- */

test('R5: a large context-menu batch asks for confirmation instead of downloading silently', async () => {
  const many = Array.from({ length: 40 }, (_, i) => 'https://cdn.test/img' + i + '.jpg');
  const m = menu3({ images: many, prefs: {} });
  m.click();
  await settle();
  assert.equal(m.downloads.length, 0, 'nothing is downloaded before the user confirms');
  const pending = m.session.imgdl_pendingBatch;
  assert.ok(Array.isArray(pending) && pending.length === 40,
    'the batch is held for confirmation instead of being downloaded');
});

test('R5b: the many-files warning can be disabled, and small batches download immediately', async () => {
  const many = Array.from({ length: 40 }, (_, i) => 'https://cdn.test/img' + i + '.jpg');
  const confirmed = menu3({ images: many, prefs: { imgdl_donotbother: true } });
  confirmed.click();
  await settle();
  assert.equal(confirmed.downloads.length, 40, '"do not show again" downloads the batch directly');

  const small = menu3({ images: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'], prefs: {} });
  small.click();
  await settle();
  assert.equal(small.downloads.length, 2, 'a small batch downloads immediately');
});

/* -------------------------------------------------------------------------- *
 * R6 — the worker never falls back to its stored download options
 * -------------------------------------------------------------------------- */

test('R6: a download request without an options snapshot uses the worker’s stored options', async () => {
  const w = worker3({
    imgdl_savefileas: 'CUSTOM_NAME',
    imgdl_savefilename: '{index}'
  });
  await w.send({ msg: 'setDownloadOptions', downloadOptions: { saveFileAs: 'CUSTOM_NAME', saveFileName: '{index}' } });
  await w.send({ msg: 'downloadImage', url: 'https://cdn.test/photo.jpg', index: 3 });
  assert.equal(w.downloads.length, 1);
  assert.equal(w.downloads[0].filename, '3.jpg',
    'the stored naming options are used when the request carries no snapshot');
});

/* -------------------------------------------------------------------------- *
 * R7 — ZIP archive naming
 * -------------------------------------------------------------------------- */

test('R7: the ZIP archive honours the naming preferences and does not nest the subfolder twice', async () => {
  const p = popup3();
  p.context.JSZip = function () {
    this.file = () => {};
    this.generateAsync = async () => new Blob(['zip']);
  };
  p.context.fetch = async () => ({ ok: true, blob: async () => new Blob(['a'], { type: 'image/png' }) });
  p.state.downloadOptions.saveFileAs = 'SYSTEM_NAME';
  p.state.downloadOptions.saveFolderName = 'photos';
  await p.downloadAsZip(['https://cdn.test/photo.png']);
  assert.equal(p.downloads.length, 1, 'one archive downloaded');
  assert.equal(p.downloads[0].filename, 'photos/images.zip',
    'the archive is placed in the requested subfolder and named after it');
});

/* -------------------------------------------------------------------------- *
 * R8 — "Save download options" rewrites the "Specify Download Options" preference
 * -------------------------------------------------------------------------- */

test('R8: saving download options from the menu never rewrites the "Specify Download Options" preference', () => {
  const p = popup3();
  p.applyPreferences({ imgdl_downloadoptionsenabled: true, imgdl_savefoldername: 'photos' });
  assert.equal(p.ids.downloadseparatefolder.checked, true);

  // The user clears the subfolder in the download menu and saves the options.
  p.ids.savefoldername.value = '';
  p.ids.saveFileAs.value = 'SYSTEM_NAME';
  p.ids.saveFileName.value = '';
  p.ids.convertFrom.value = '';
  p.state.downloadOptions.saveFolderName = '';
  p.state.downloadOptions.saveFileAs = 'SYSTEM_NAME';
  p.state.downloadOptions.saveFileName = '';
  p.state.downloadOptions.convertFrom = '';

  const saved = [];
  p.context.chrome.storage.local.set = obj => { saved.push(obj); };
  p.persistDownloadOptions();
  const last = saved[saved.length - 1];
  assert.ok(last, 'download options were persisted');
  assert.equal(last.imgdl_downloadOptionsEnabled, undefined,
    'the download menu must not write the "Specify Download Options" preference');
});

/* -------------------------------------------------------------------------- *
 * R9 — the hotkey badge
 * -------------------------------------------------------------------------- */

test('R9: the Preferences hotkey badge shows the shortcut configured for this platform', () => {
  const p = popup3();
  p.context.chrome.commands = { getAll: cb => cb([{ name: '_execute_action', shortcut: 'Ctrl+Shift+Y' }]) };
  p.updateHotkeyBadge();
  const badge = p.ids.openHotKeyPrefs;
  assert.ok(badge, 'the hotkey badge exists');
  assert.ok(/Ctrl/i.test(badge.textContent) && /Y/.test(badge.textContent),
    'the badge shows the platform shortcut, got: ' + badge.textContent);
});

/* -------------------------------------------------------------------------- *
 * R10 — full-resolution URLs are not highlighted
 * -------------------------------------------------------------------------- */

test('R10: the page highlights the original image even when the grid shows the full-resolution URL', () => {
  const original = 'https://cdn.test/pic-300x200.jpg';
  const upgraded = 'https://cdn.test/pic.jpg';
  const img = new El('img');
  img.src = original;
  const document = {
    querySelectorAll: sel => (sel === '*' ? [img] : []),
    getElementById: () => null,
    createElement: tag => new El(tag),
    documentElement: new El(),
    head: new El()
  };
  const window = { addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(source('inject.js'), {
    window, document, NodeFilter: { SHOW_ELEMENT: 1 },
    location: { href: 'https://cdn.test/' }, URL, Set,
    localStorage: { getItem: () => null },
    chrome: { runtime: { onMessage: { addListener() {} } } }
  });
  window.__idbInject.highlight([upgraded], [original]);
  assert.equal(img.classes.has('idb-img-highlight'), true,
    'the image the page actually renders is highlighted');
});
