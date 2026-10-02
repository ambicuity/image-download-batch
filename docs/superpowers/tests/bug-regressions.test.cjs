// Run with: node --test docs/superpowers/tests/bug-regressions.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.style = {};
    this.events = {}; this.value = ''; this.classes = new Set();
    this.classList = {
      add: c => this.classes.add(c), remove: c => this.classes.delete(c),
      contains: c => this.classes.has(c),
      toggle: (c, on = !this.classes.has(c)) => on ? this.classes.add(c) : this.classes.delete(c)
    };
  }
  set className(v) { this.classes = new Set(v.split(' ')); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; delete this[k]; }
  appendChild(el) { this.children.push(el); el.parent = this; return el; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  get parentNode() { return this.parent || null; }
  removeChild(el) { this.children = this.children.filter(c => c !== el); el.parent = null; }
  removeEventListener() {}
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  fire(k, extra = {}) { (this.events[k] || []).forEach(fn => fn({ target: this, ...extra })); }
  contains(el) { return this === el || this.children.some(c => c.contains(el)); }
  matches(sel) {
    if (sel === 'label') return this.tagName === 'LABEL';
    return sel.startsWith('.') && sel.split(':')[0].split('.').filter(Boolean).every(c => this.classes.has(c));
  }
  querySelectorAll(sel) {
    return this.children.flatMap(c => [c, ...c.querySelectorAll(sel)]).filter(c => c.matches(sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function popup() {
  const ids = {};
  ['imgsContainer', 'downloadButton', 'downloadMenu', 'prefsDiv', 'manyfiles', 'minwidthinput', 'minheightinput', 'selectalla', 'container', 'downloadseparatefolder', 'downloadocationcontainer', 'savefoldername', 'savefoldernamePrefs', 'saveFileAs', 'saveFileAsPref', 'saveFileName', 'saveFileNamePref', 'convertFrom', 'convertFromPrefs', 'convertTo', 'convertToPrefs', 'downloadAsZip', 'stopImageSearch'].forEach(id => ids[id] = new Element());
  ids.downloadButton.appendChild(ids.downloadMenu);
  const document = new Element();
  document.readyState = 'loading'; document.body = new Element(); document.head = new Element();
  document.getElementById = id => ids[id] || null;
  document.createElement = tag => new Element(tag);
  document.querySelectorAll = sel => sel.startsWith('.imgContainer') ? ids.imgsContainer.querySelectorAll(sel) : [];
  document.querySelector = sel => document.querySelectorAll(sel)[0] || null;
  const messages = [], probes = [], timers = new Map(); let timerId = 0;
  const context = vm.createContext({ document, URL, URLSearchParams, Blob, Set, Uint8Array, TextEncoder, AbortController, atob, unescape, encodeURIComponent,
    window: { location: { search: '' } },
    getComputedStyle: () => ({ display: 'none' }),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    Image: function () { probes.push(this); },
    chrome: { runtime: { sendMessage: (m, cb) => { messages.push(m); if (cb) cb({ success: true }); } },
      tabs: { sendMessage() {} }, storage: { local: { set() {} } }, i18n: { getMessage: () => '' } }
  });
  const code = source('popup.js').replace('  // Boot\n', '  // Boot\n globalThis.api = { state, show, wireDownloadMenu, wireFilters, renderImages, probeImageDimensions, dataUrlToBlob, downloadSingleImage, downloadDataUrl, applyFiltersAndSort, applyPreferences, wirePreferences, savePreferences, fetchAsBlob, loadZipLibrary, getZipEntry, listenForReturnSelection, listenForTabChanges, cropDataUrl, convertImage, downloadAsZip, getZipConstructor, getExtensionFromUrl, startScraping, wireReloadAndStop, clearFilters };\n');
  vm.runInContext(code, context);
  return { ...context.api, context, document, ids, messages, probes, flush: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn()); } };
}
function worker(failWrite = false) {
  let message, installed, determining, actionClicked; const downloads = []; let clears = 0;
  const chrome = { runtime: { id: 'test', onMessage: { addListener: fn => message = fn }, onConnect: { addListener() {} }, onInstalled: { addListener: fn => installed = fn } },
    storage: { local: { get: (_, cb) => cb({}), set: (_, cb) => { chrome.runtime.lastError = failWrite ? { message: 'quota' } : undefined; cb(); chrome.runtime.lastError = undefined; } },
      sync: { get: (_, cb) => cb({ savefilename: 'kept' }), clear: cb => { clears++; cb(); } } },
    action: { setPopup() {}, onClicked: { addListener: fn => actionClicked = fn } }, downloads: { download: (opts, cb) => { downloads.push(opts); cb(downloads.length); }, onDeterminingFilename: { addListener: fn => determining = fn }, onChanged: { addListener() {} } } };
  const context = vm.createContext({ chrome, URL, Date, TextEncoder });
  context.importScripts = file => vm.runInContext(source(file), context);
  vm.runInContext(source('filenameTokens.js'), context);
  vm.runInContext(source('background.js'), context);
  return { context, downloads, clickAction: tab => actionClicked(tab), sendAsync: (m, sender = {}) => new Promise(resolve => message(m, sender, resolve)), send: m => message(m, {}, () => {}), migrate: () => installed({ reason: 'update' }), determining, get clears() { return clears; } };
}

test('1: hidden download menu and modal open; menu inputs do not close it', () => {
  const p = popup(); p.show(p.ids.prefsDiv); p.show(p.ids.manyfiles);
  assert.equal(p.ids.prefsDiv.style.display, 'block'); assert.equal(p.ids.manyfiles.style.display, 'block');
  p.wireDownloadMenu(); p.ids.downloadButton.fire('click');
  assert.equal(p.ids.downloadMenu.style.display, 'block');
  p.ids.downloadButton.fire('click', { target: p.ids.downloadMenu });
  assert.equal(p.ids.downloadMenu.style.display, 'block');
  p.ids.downloadButton.fire('click'); assert.equal(p.ids.downloadMenu.style.display, 'none');
});
test('2: dimensions arriving after render reapply size and pixel sort', () => {
  const p = popup();
  p.state.allImages = [{ url: 'https://x/a.jpg', index: 0, loaded: false, w: 0, h: 0 }, { url: 'https://x/b.jpg', index: 1, loaded: false, w: 0, h: 0 }];
  p.state.filters.size = 'large'; p.renderImages();
  p.probes[0].naturalWidth = 100; p.probes[0].naturalHeight = 100; p.probes[0].onload();
  p.probes[1].naturalWidth = 900; p.probes[1].naturalHeight = 800; p.probes[1].onload(); p.flush();
  assert.deepEqual(p.ids.imgsContainer.children.map(c => c.getAttribute('imgsrc')), ['https://x/b.jpg']);
  p.state.filters.size = 'any'; p.renderImages();
  assert.deepEqual(p.ids.imgsContainer.children.map(c => c.getAttribute('imgsrc')), ['https://x/b.jpg', 'https://x/a.jpg']);
});
test('3: selection survives filter and sort rerenders', () => {
  const p = popup(); const url = 'https://x/a.jpg';
  p.state.allImages = [{ url, index: 0, loaded: true, w: 100, h: 100 }]; p.renderImages();
  let cb = p.ids.imgsContainer.querySelector('.imgCheckbox'); cb.checked = true; cb.fire('change');
  p.state.filters.url = 'missing'; p.renderImages(); p.state.filters.url = ''; p.renderImages();
  cb = p.ids.imgsContainer.querySelector('.imgCheckbox'); assert.equal(cb.checked, true);
  cb.checked = false; cb.fire('change'); p.renderImages(); assert.equal(p.ids.imgsContainer.querySelector('.imgCheckbox').checked, false);
});
test('4: editing custom size updates the filter without reclicking the option', () => {
  const p = popup(); p.wireFilters(); p.ids.minwidthinput.value = '600'; p.ids.minheightinput.value = '300'; p.ids.minwidthinput.fire('input');
  assert.equal(p.state.filters.size, 'custom'); assert.equal(p.state.filters.minWidth, 600); assert.equal(p.state.filters.minHeight, 300);
});
test('5: indexed, isolated naming preserves signed URLs and converted extensions', () => {
  const p = popup(), w = worker(); const url = 'https://cdn.test/photo.webp?token=signed&index=99';
  p.state.downloadOptions.saveFileAs = 'CUSTOM_NAME'; p.state.downloadOptions.saveFileName = '{name}-{index:3}';
  p.downloadSingleImage(url, 6); p.state.downloadOptions.saveFileName = 'other'; w.send(p.messages[0]);
  assert.equal(w.downloads[0].url, url); assert.equal(w.downloads[0].filename, 'photo-007.webp');
  p.downloadDataUrl('data:image/png;base64,YQ==', url, 7); w.send(p.messages[1]);
  assert.equal(w.downloads[1].filename, 'other.png');
  w.send({ msg: 'downloadImage', url: 'data:image/png;base64,YQ==', index: 1 });
  assert.equal(w.downloads[2].filename, 'imgi_1_image.png');
  w.send({ msg: 'downloadImage', url, index: 2, downloadOptions: { saveFolderName: '../bad/folder' } });
  assert.equal(w.downloads[3].filename, '.._bad_folder/imgi_2_photo.webp');
  // Chrome ignores download()'s filename when a determining listener is present.
  assert.equal(w.determining, undefined);
});
test('capture declares the gesture-scoped permission required by Chrome', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.ok(manifest.permissions.includes('activeTab'));
});
test('6: percent-encoded data URL bytes decode correctly for ZIP entries', async () => {
  const p = popup(); assert.equal(await p.dataUrlToBlob('data:image/svg+xml,%3Csvg%3E%C3%A9%3C%2Fsvg%3E').text(), '<svg>é</svg>');
  assert.deepEqual([...new Uint8Array(await p.dataUrlToBlob('data:application/octet-stream,%FF%00').arrayBuffer())], [255, 0]);
});
test('7: failed preference migration retains sync; successful migration clears it', () => {
  const failed = worker(true); failed.migrate(); assert.equal(failed.clears, 0);
  const success = worker(); success.migrate(); assert.equal(success.clears, 1);
});
test('8: unloaded lazy images are not classified as tracking pixels', () => {
  const code = source('imageScraper.js').match(/function isTrackingPixel\(img\) \{[\s\S]*?\n  \}/)[0];
  const ctx = vm.createContext({}); vm.runInContext(code, ctx);
  assert.equal(ctx.isTrackingPixel({ complete: false, naturalWidth: 0, naturalHeight: 0 }), false);
  assert.equal(ctx.isTrackingPixel({ complete: true, naturalWidth: 0, naturalHeight: 0 }), false);
  assert.equal(ctx.isTrackingPixel({ complete: true, naturalWidth: 1, naturalHeight: 1 }), true);
});
test('9: raw HTML image URL extraction retains query and full extension', () => {
  const code = source('imageScraper.js').match(/var rawRe = .*;/)[0];
  const ctx = vm.createContext({}); vm.runInContext(code, ctx);
  assert.deepEqual(Array.from('"https://x/a.jpeg?signature=abc&amp;width=200" https://x/b.tiff'.match(ctx.rawRe)), ['https://x/a.jpeg?signature=abc&amp;width=200', 'https://x/b.tiff']);
  assert.equal('https://x/a.jpg.js'.match(ctx.rawRe), null);
});
test('10: replacing/clearing page selection removes stale highlights in nested shadow roots', () => {
  const a = new Element('img'), b = new Element('img'); a.src = 'https://x/a.jpg'; b.src = 'https://x/b.jpg';
  const nestedHost = new Element(), host = new Element(); nestedHost.shadowRoot = { querySelectorAll: () => [b] }; host.shadowRoot = { querySelectorAll: sel => sel === 'img' ? [] : [nestedHost] };
  const window = { addEventListener() {} }, document = {
    images: [a], body: {}, querySelectorAll: sel => sel === '*' ? [a, host] : [a, b].filter(img => img.classList.contains('idb-img-highlight')),
    getElementById: () => ({}), createTreeWalker: () => { let done = false; return { nextNode: () => done ? null : (done = true, host) }; }
  };
  vm.runInNewContext(source('inject.js'), { window, document, NodeFilter: { SHOW_ELEMENT: 1 }, location: { href: 'https://x/' }, URL, Set, localStorage: { getItem: () => null }, chrome: { runtime: { onMessage: { addListener() {} } } } });
  window.__idbInject.highlight([a.src, b.src]); assert.equal(b.classList.contains('idb-img-highlight'), true);
  window.__idbInject.highlight([a.src]); assert.equal(b.classList.contains('idb-img-highlight'), false);
  window.__idbInject.highlight([b.src]); window.__idbInject.clear(); assert.equal(b.classList.contains('idb-img-highlight'), false);
});


test('11: Preferences exposes and saves naming/conversion controls into download menu', () => {
  const p = popup(); p.applyPreferences({ imgdl_savefileas: 'CUSTOM_NAME', imgdl_savefilename: '{index}' });
  assert.equal(p.ids.saveFileAsPref.value, 'CUSTOM_NAME');
  assert.equal(p.ids.downloadseparatefolder.checked, true);
  p.ids.savefoldernamePrefs.value = 'photos'; p.ids.saveFileNamePref.value = 'shot-{index}';
  p.ids.convertFromPrefs.value = 'ALL'; p.ids.convertToPrefs.value = 'png'; p.savePreferences();
  assert.equal(p.ids.savefoldername.value, 'photos'); assert.equal(p.state.downloadOptions.convertTo, 'png');
  assert.equal(p.ids.saveFileName.value, 'shot-{index}');
  p.ids.downloadseparatefolder.checked = false; p.savePreferences();
  assert.equal(p.state.downloadOptions.saveFileAs, 'SYSTEM_NAME'); assert.equal(p.state.downloadOptions.convertFrom, '');
});
test('12: ZIP fetch skips HTTP errors and returns successful image bytes', async () => {
  const p = popup();
  p.context.fetch = async () => ({ ok: false, status: 404, blob: async () => new Blob(['error page']) });
  assert.equal(await new Promise(resolve => p.fetchAsBlob('https://x/missing.png', resolve)), null);
  p.context.fetch = async () => ({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) });
  assert.equal(await (await new Promise(resolve => p.fetchAsBlob('https://x/good.png', resolve))).text(), 'image');
});
test('13: ZIP library failure rejects once and permits a later retry', async () => {
  const p = popup(); const pending = p.loadZipLibrary();
  p.document.head.children[0].onerror(); await assert.rejects(pending, /Could not load/);
  const retry = p.loadZipLibrary(); p.context.JSZip = function Zip() {};
  p.document.head.children[0].onload(); assert.equal(await retry, p.context.JSZip);
});
test('14: ZIP uses naming tokens, source domains, and image MIME extension', async () => {
  const p = popup(); vm.runInContext(source('filenameTokens.js'), p.context); vm.runInContext(source('sanitize.js'), p.context);
  p.context.fetch = async () => ({ ok: true, blob: async () => new Blob(['a'], { type: 'image/png' }) });
  const entry = await p.getZipEntry('https://cdn.test/photo', 6, { saveFileAs: 'CUSTOM_NAME', saveFileName: '{name}-{index:3}', saveFolderName: 'basedonurl' });
  assert.equal(entry.filename, 'cdn.test/photo-007.png');
});
test('15: crop messages require pending selection from the correct tab and top frame', () => {
  const p = popup(); let listener, queries = 0;
  p.context.chrome.runtime.onMessage = { addListener: fn => listener = fn };
  p.context.chrome.tabs.query = (_, cb) => { queries++; cb([]); };
  p.state.tabId = 3; p.state.capturePending = true; p.listenForReturnSelection();
  const message = { type: 'returnSelection', rect: { x: 1, y: 2, width: 10, height: 10 } };
  listener(message, { tab: { id: 4 }, frameId: 0 }); assert.equal(queries, 0);
  listener(message, { tab: { id: 3 }, frameId: 1 }); assert.equal(queries, 0);
  listener({ ...message, rect: { ...message.rect, width: NaN } }, { tab: { id: 3 }, frameId: 0 }); assert.equal(queries, 0);
  listener(message, { tab: { id: 3 }, frameId: 0 }); assert.equal(queries, 1); assert.equal(p.state.capturePending, false);
});
test('16: sanitizer keeps reserved names safe and caps Unicode filenames in bytes', () => {
  const ctx = vm.createContext({ TextEncoder }); vm.runInContext(source('sanitize.js'), ctx);
  assert.equal(ctx.sanitizeFilename('CON.jpg'), '_CON.jpg');
  assert.equal(ctx.sanitizeFilename('CON '), '_CON');
  const name = ctx.sanitizeFilename('📷'.repeat(100) + '.png');
  assert.ok(new TextEncoder().encode(name).length <= 255); assert.ok(name.endsWith('.png'));
  assert.equal(ctx.sanitizeFilename('../bad\\folder'), '.._bad_folder');
});
test('17: full-resolution rewriting leaves signed CDN queries/path untouched', () => {
  const code = source('imageScraper.js').split('/* __UPGRADE_START__ */')[1].split('/* __UPGRADE_END__ */')[0];
  const ctx = vm.createContext({ URL }); vm.runInContext(code, ctx);
  for (const url of ['https://x/photo-200x100.jpg?w=200&signature=abc', 'https://x/photo.jpg?X-Amz-Signature=abc&w=20', 'https://res.cloudinary.com/x/image/upload/s--abc--/w_200/photo.jpg']) {
    assert.equal(ctx.upgradeUrl(url), url);
  }
});


test('18: display-mode changes configure native toolbar behavior and report API errors', async () => {
  const w = worker(); const calls = [];
  w.context.chrome.sidePanel = {
    setOptions: opts => { calls.push(['options', opts]); return Promise.resolve(); },
    setPanelBehavior: opts => { calls.push(['behavior', opts]); return Promise.resolve(); },
    open: opts => { calls.push(['open', opts]); return Promise.resolve(); }
  };
  assert.equal((await w.sendAsync({ msg: 'changeDisplayMode', displayMode: 'sidePanel' })).success, true);
  assert.ok(calls.some(([name, opts]) => name === 'options' && opts.enabled && opts.path.includes('view=sidePanel')));
  assert.ok(calls.some(([name, opts]) => name === 'behavior' && opts.openPanelOnActionClick === false));
  assert.equal(calls.some(([name]) => name === 'open'), false);
  w.clickAction({ id: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['open', { tabId: 8 }]);
  assert.equal((await w.sendAsync({ msg: 'openExtension' }, { tab: { id: 7 } })).success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['open', { tabId: 7 }]);
  w.context.chrome.sidePanel.setOptions = () => Promise.reject(new Error('API failure'));
  assert.equal((await w.sendAsync({ msg: 'changeDisplayMode', displayMode: 'popup' })).success, false);
});
test('19: page-to-worker UI bridge uses the worker message discriminator', () => {
  let bridge, message;
  const window = { addEventListener: (event, fn) => { if (event === 'message') bridge = fn; } };
  vm.runInNewContext(source('inject.js'), { window, localStorage: { getItem: () => null }, location: { href: 'https://x/' }, navigator: { userActivation: { isActive: true } },
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: (m, cb) => { message = m; cb(); } } } });
  bridge({ source: window, data: { action: 'imgdl_open' } }); assert.equal(message.msg, 'openExtension');
});
test('20: capture tears down overlay before waiting for page paint and sending coordinates', () => {
  const document = new Element(); document.documentElement = new Element(); document.getElementById = () => null;
  document.createElement = tag => new Element(tag); document.removeEventListener = () => {};
  const frames = [], messages = [];
  const window = { addEventListener() {}, removeEventListener() {}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 2 };
  vm.runInNewContext(source('captureSelection.js'), { document, window, requestAnimationFrame: fn => frames.push(fn),
    chrome: { runtime: { sendMessage: (m, cb) => { messages.push(m); cb(); } } } });
  const overlay = document.documentElement.children.find(el => el.classList.contains('__idb-cs-overlay'));
  overlay.fire('mousedown', { clientX: 20, clientY: 20, button: 0, preventDefault() {} });
  overlay.fire('mouseup', { clientX: 120, clientY: 100, preventDefault() {} });
  assert.equal(document.documentElement.children.length, 0); assert.equal(messages.length, 0);
  frames.shift()(); assert.equal(messages.length, 0); frames.shift()();
  assert.equal(messages[0].rect.viewportWidth, 800); assert.equal(messages[0].rect.width, 100);
});
test('21: conversion timeout completes only once and ZIP ignores zero successful images', async () => {
  const p = popup(); let completions = 0;
  p.convertImage('https://x/hanging.png', 'png', result => { assert.equal(result, null); completions++; });
  p.flush(); p.probes[0].onerror(); assert.equal(completions, 1);
  vm.runInContext(source('filenameTokens.js'), p.context); vm.runInContext(source('sanitize.js'), p.context);
  p.context.JSZip = function () { this.file = () => {}; this.generateAsync = () => { throw new Error('Should not create an empty ZIP'); }; };
  p.context.fetch = async () => ({ ok: false, status: 404 });
  await p.downloadAsZip(['https://x/missing.png']);
  assert.ok(p.document.body.children.some(el => el.children.some(toast => toast.textContent.includes('No images could be fetched'))));
});


test('22: vendored webpack chunk exports a usable JSZip constructor', async () => {
  const p = popup(); p.context.self = p.context; p.context.setImmediate = setImmediate; p.context.ArrayBuffer = ArrayBuffer;
  vm.runInContext(source('733.js'), p.context);
  assert.equal(p.context.JSZip, undefined);
  const Zip = p.getZipConstructor(); assert.equal(typeof Zip, 'function');
  const archive = new Zip(); archive.file('photo.txt', 'original bytes');
  const bytes = await archive.generateAsync({ type: 'uint8array' });
  const reopened = await Zip.loadAsync(bytes);
  assert.equal(await reopened.file('photo.txt').async('string'), 'original bytes');
});
test('23: non-base64 SVG data URIs retain their image format', () => {
  const p = popup(); assert.equal(p.getExtensionFromUrl('data:image/svg+xml,%3Csvg/%3E'), 'SVG');
});


test('24: side panel follows its window active tab and discards stale scan responses', () => {
  const p = popup(); const scans = [], listeners = {};
  p.state.tabId = 1; p.state.tabWindowId = 8; p.state.isSidePanel = true;
  p.context.chrome.runtime.connect = () => ({ disconnect() {} });
  p.context.chrome.tabs.query = (_, cb) => cb([{ id: 2, windowId: 8, url: 'https://x/new' }]);
  p.context.chrome.tabs.onActivated = { addListener: fn => listeners.activated = fn };
  p.context.chrome.tabs.onUpdated = { addListener: fn => listeners.updated = fn };
  p.context.chrome.scripting = { executeScript: (opts, cb) => scans.push({ opts, cb }) };
  p.startScraping(); p.listenForTabChanges();
  listeners.activated({ tabId: 99, windowId: 9 }); assert.equal(scans.length, 1);
  listeners.activated({ tabId: 2, windowId: 8 }); assert.equal(scans[1].opts.target.tabId, 2);
  scans[1].cb([{ result: { images: ['https://x/new.jpg'] } }]);
  scans[0].cb([{ result: { images: ['https://x/old.jpg'] } }]);
  assert.equal(p.state.allImages[0].url, 'https://x/new.jpg');
});
test('25: screenshot crop scales from the source viewport and bounds the rectangle', () => {
  const p = popup(); let args, canvas;
  p.document.createElement = tag => {
    if (tag !== 'canvas') return new Element(tag);
    canvas = { getContext: () => ({ drawImage: (...input) => args = input }), toDataURL: () => 'cropped' }; return canvas;
  };
  let result;
  p.cropDataUrl('data:image/png;base64,YQ==', { x: 10, y: 20, width: 100, height: 80, viewportWidth: 600, viewportHeight: 400, devicePixelRatio: 2 }, value => result = value);
  p.probes[0].naturalWidth = 900; p.probes[0].naturalHeight = 600; p.probes[0].onload();
  assert.deepEqual(args.slice(1, 5), [15, 30, 150, 120]); assert.equal(canvas.width, 150); assert.equal(result, 'cropped');
});


// ---- Second audit pass (B1–B10) ----
const scraperFn = name => {
  const code = source('imageScraper.js').match(new RegExp('function ' + name + '\\(\\w+\\) \\{[\\s\\S]*?\\n  \\}'))[0];
  const ctx = vm.createContext({}); vm.runInContext(code, ctx); return ctx[name];
};
test('B1: srcset parsing keeps commas inside candidate URLs (Cloudinary, data URIs)', () => {
  const parse = scraperFn('parseSrcset');
  assert.deepEqual(Array.from(parse('https://c/upload/w_300,c_fill/a.jpg 300w, https://c/upload/w_600,c_fill/a.jpg 600w')),
    ['https://c/upload/w_300,c_fill/a.jpg', 'https://c/upload/w_600,c_fill/a.jpg']);
  assert.deepEqual(Array.from(parse('a.png 1x, data:image/png;base64,AAA= 2x')), ['a.png', 'data:image/png;base64,AAA=']);
  assert.deepEqual(Array.from(parse('a.png 1x,b.png, c.png 3x')), ['a.png', 'b.png', 'c.png']);
});
test('B2: CSS url() extraction keeps quoted URLs containing quotes and escapes', () => {
  const extract = scraperFn('extractBackgroundUrls');
  const svg = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0'/></svg>";
  assert.deepEqual(Array.from(extract('url("' + svg + '")')), [svg]);
  assert.deepEqual(Array.from(extract('url("a\\"b.png"), url(x.png), url(\'y.png\')')), ['a"b.png', 'x.png', 'y.png']);
});
test('B3: converting to JPEG paints a white background under transparent pixels', () => {
  for (const [format, expectFill] of [['jpeg', true], ['png', false]]) {
    const p = popup(); const calls = [];
    p.document.createElement = tag => tag !== 'canvas' ? new Element(tag) : {
      getContext: () => ({ fillRect: () => calls.push('fill'), drawImage: () => calls.push('draw'), set fillStyle(v) { calls.push('style:' + v); } }),
      toDataURL: mime => 'data:' + mime + ';base64,AA'
    };
    p.convertImage('https://x/a.png', format, () => {});
    Object.assign(p.probes[0], { naturalWidth: 4, naturalHeight: 4 }); p.probes[0].onload();
    assert.deepEqual(calls, expectFill ? ['style:#ffffff', 'fill', 'draw'] : ['draw']);
  }
});
test('B4: extensionless image URLs still download with an image extension', async () => {
  const w = worker(); let heads = 0;
  w.context.setTimeout = setTimeout; w.context.clearTimeout = clearTimeout; w.context.AbortController = AbortController;
  w.context.fetch = async (url, opts) => { heads++; assert.equal(opts.method, 'HEAD'); return { ok: true, headers: { get: () => 'image/webp; charset=binary' } }; };
  await w.sendAsync({ msg: 'downloadImage', url: 'https://pbs.twimg.com/media/X1?format=jpg&name=large', index: 1 });
  assert.equal(w.downloads[0].filename, 'imgi_1_X1.jpg'); assert.equal(heads, 0);
  await w.sendAsync({ msg: 'downloadImage', url: 'https://cdn.test/media/abc', index: 2 });
  assert.equal(w.downloads[1].filename, 'imgi_2_abc.webp'); assert.equal(heads, 1);
  await w.sendAsync({ msg: 'downloadImage', url: 'https://cdn.test/media/my.photo?fm=png', index: 4 });
  assert.equal(w.downloads[2].filename, 'imgi_4_my.photo.png');
  await w.sendAsync({ msg: 'downloadImage', url: 'https://cdn.test/img.php?id=1&fm=gif', index: 5 });
  assert.equal(w.downloads[3].filename, 'imgi_5_img.gif');
  w.context.fetch = async () => { throw new Error('offline'); };
  await w.sendAsync({ msg: 'downloadImage', url: 'https://cdn.test/view.php?id=3', index: 3 });
  assert.equal(w.downloads[4].filename, 'imgi_3_view.php');
});
test('B5: ZIP fetches run with bounded concurrency so queued requests do not time out', async () => {
  const p = popup(); vm.runInContext(source('filenameTokens.js'), p.context); vm.runInContext(source('sanitize.js'), p.context);
  p.context.JSZip = function () { this.file = () => {}; this.generateAsync = async () => new Blob(['zip']); };
  const pending = []; let inFlight = 0, maxInFlight = 0;
  p.context.fetch = () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise(resolve => pending.push(() => { inFlight--; resolve({ ok: true, blob: async () => new Blob(['a'], { type: 'image/png' }) }); })); };
  const urls = Array.from({ length: 20 }, (_, i) => 'https://x/' + i + '.png');
  let settled = false; const done = p.downloadAsZip(urls).then(() => settled = true);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 200 && !settled; i++) { await tick(); const next = pending.shift(); if (next) next(); }
  await done;
  assert.ok(maxInFlight > 0 && maxInFlight <= 6, 'max in flight was ' + maxInFlight);
});
test('B6: extension detection uses the last path segment and treats .tif as TIFF', () => {
  const p = popup();
  assert.equal(p.getExtensionFromUrl('https://x/v1.2/photo'), '');
  assert.equal(p.getExtensionFromUrl('https://x/scan.tif'), 'TIFF');
  p.state.filters.type = 'TIFF'; p.state.filters.sort = 'index';
  assert.equal(p.applyFiltersAndSort([{ url: 'https://x/scan.tif', index: 0 }]).length, 1);
});
test('B7: Stop ends the scan immediately and ignores the late result', () => {
  const p = popup(); let callback;
  p.state.tabId = 1; p.context.chrome.scripting = { executeScript: (_, cb) => callback = cb };
  p.wireReloadAndStop(); p.startScraping(); assert.equal(p.state.isScraping, true);
  p.ids.stopImageSearch.fire('click');
  assert.equal(p.state.isScraping, false); assert.equal(p.ids.stopImageSearch.style.display, 'none');
  callback([{ result: { images: ['https://x/late.jpg'] } }]);
  assert.equal(p.state.allImages.length, 0);
});
test('B8: images that fail to load are not re-requested on every re-render', () => {
  const p = popup();
  p.state.allImages = [{ url: 'https://x/broken.jpg', index: 0, loaded: false, w: 0, h: 0 }];
  p.renderImages(); assert.equal(p.probes.length, 1); p.probes[0].onerror();
  p.renderImages(); p.renderImages();
  assert.equal(p.probes.length, 1);
  const thumb = p.ids.imgsContainer.querySelector('.imgThumb');
  assert.equal(thumb.src, undefined); assert.equal(thumb.classList.contains('imgThumb--error'), true);
});
test('B9: a restored size filter shows Clear, and Clear resets the minimum inputs', () => {
  const p = popup(); const clear = new Element();
  p.document.querySelector = sel => sel === '.clearFilters' ? clear : null;
  p.applyPreferences({ imgdl_sizetype: 'custom', imgdl_minwidth: 400, imgdl_minheight: 300 });
  assert.equal(clear.style.display, '');
  p.clearFilters();
  assert.equal(clear.style.display, 'none'); assert.equal(String(p.ids.minwidthinput.value), '0'); assert.equal(String(p.ids.minheightinput.value), '0');
});
test('B10: pages cannot open the extension UI without a user gesture', () => {
  let bridge, sent = 0; const activation = { isActive: false };
  const window = { addEventListener: (event, fn) => { if (event === 'message') bridge = fn; } };
  vm.runInNewContext(source('inject.js'), { window, localStorage: { getItem: () => null }, location: { href: 'https://x/' }, navigator: { userActivation: activation },
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: (_, cb) => { sent++; cb(); } } } });
  bridge({ source: window, data: { action: 'imgdl_open' } }); assert.equal(sent, 0);
  activation.isActive = true; bridge({ source: window, data: { action: 'imgdl_open' } }); assert.equal(sent, 1);
});
