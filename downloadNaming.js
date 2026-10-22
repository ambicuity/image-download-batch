/*!
 * downloadNaming.js — shared download-naming logic for Image Download - Batch.
 *
 * Extracted from background.js so that every download route (the popup's
 * per-image downloads, the ZIP builder and the "Download all images on this
 * page" context menu) produces the same file names and honours the same
 * user preferences.
 *
 * Exposes (global scope, so importScripts() makes them available to the
 * service worker):
 *   shapeDownloadFilename(params)  — final relative filename for a download
 *   resolveFinalName(source, dl)   — resolved basename (with image extension)
 *   inferImageExtension(url)       — extension inferred from a URL
 *   resolveSubfolder(folder, url)  — resolved subfolder segment
 *   mergeDownloadOptions(a, b)     — per-request snapshot over stored options
 *
 * Original implementation for Image Download - Batch by Ritesh Rana.
 */
(function () {
  'use strict';

  // Image file extensions recognised in a file name.
  var IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?|jfif|heic|heif)$/i;

  // Server-script suffixes replaced by the inferred image extension
  // (view.php -> view.jpg).
  var SCRIPT_EXT_RE = /\.(?:php|aspx?|ashx|axd|jsp|cgi|do|html?)$/i;

  // Query parameters image CDNs use to select the output format.
  var FORMAT_PARAMS = ['format', 'fm', 'ext'];

  // Maximum time spent inferring an extension from a HEAD request.
  var HEAD_TIMEOUT_MS = 5000;

  /**
   * Map a format/MIME subtype to a file extension, or '' when not an image type.
   * @param {string} value
   * @returns {string}
   */
  function normalizeImageExt(value) {
    var ext = String(value || '').toLowerCase().split('+')[0];
    if (ext === 'jpeg' || ext === 'pjpeg') ext = 'jpg';
    if (ext === 'x-icon' || ext === 'vnd.microsoft.icon') ext = 'ico';
    return IMAGE_EXT_RE.test('.' + ext) ? ext : '';
  }

  /**
   * Determine the image extension of a URL whose path has none: first from a
   * format query parameter, then from a HEAD request's Content-Type.
   * @param {string} url
   * @returns {Promise<string>} extension without the dot, or ''
   */
  function inferImageExtension(url) {
    var params;
    try { params = new URL(url).searchParams; } catch (e) { return Promise.resolve(''); }
    for (var i = 0; i < FORMAT_PARAMS.length; i++) {
      var fromQuery = normalizeImageExt(params.get(FORMAT_PARAMS[i]));
      if (fromQuery) return Promise.resolve(fromQuery);
    }
    if (typeof fetch !== 'function') return Promise.resolve('');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, HEAD_TIMEOUT_MS);
    return fetch(url, { method: 'HEAD', credentials: 'include', signal: controller.signal }).then(function (response) {
      var type = (response.ok && response.headers.get('content-type')) || '';
      var match = type.match(/^\s*image\/([a-z0-9.+-]+)/i);
      return match ? normalizeImageExt(match[1]) : '';
    }).catch(function () { return ''; }).then(function (ext) {
      clearTimeout(timer);
      return ext;
    });
  }

  /**
   * Resolve a subfolder name. "basedonurl" means use the hostname of the
   * source URL; any other non-empty value is used literally.
   * @param {string} folder — raw folder preference
   * @param {string} url — source URL (for hostname resolution)
   * @returns {string} resolved folder segment (no trailing slash), or ''
   */
  function resolveSubfolder(folder, url) {
    if (!folder) return '';
    if (folder === 'basedonurl') {
      try {
        var host = new URL(url).hostname;
        return host || '';
      } catch (e) {
        return '';
      }
    }
    return String(folder);
  }

  /**
   * Extract the download index from a URL's query string if present.
   * Compatibility fallback; current callers supply the index separately.
   * @param {string} url
   * @returns {string} index string, defaults to '1'
   */
  function extractIndexFromUrl(url) {
    try {
      var idx = new URL(url).searchParams.get('index');
      return idx || '1';
    } catch (e) {
      return '1';
    }
  }

  /**
   * Merge a per-request options snapshot over the stored download options.
   * An absent/empty snapshot falls back to the stored options; an explicit
   * snapshot always wins field by field.
   * @param {object} snapshot — per-request options (may be empty)
   * @param {object} stored — options kept by the worker (may be null)
   * @returns {object} the effective options
   */
  function mergeDownloadOptions(snapshot, stored) {
    var snap = snapshot || {};
    var base = stored || {};
    function pick(key, fallback) {
      if (Object.prototype.hasOwnProperty.call(snap, key) && snap[key] !== undefined && snap[key] !== null) {
        return snap[key];
      }
      if (Object.prototype.hasOwnProperty.call(base, key) && base[key] !== undefined && base[key] !== null) {
        return base[key];
      }
      return fallback;
    }
    return {
      saveFileAs: pick('saveFileAs', 'SYSTEM_NAME') || 'SYSTEM_NAME',
      saveFileName: pick('saveFileName', '') || '',
      saveFolderName: pick('saveFolderName', '') || '',
      convertFrom: pick('convertFrom', '') || '',
      convertTo: pick('convertTo', 'jpeg') || 'jpeg',
      downloadAsZip: !!pick('downloadAsZip', false)
    };
  }

  /**
   * Resolve the base name (with an image extension) for a download.
   *
   * @param {string} sourceUrl — the URL the file came from (used for the name)
   * @param {string} downloadUrl — the URL actually downloaded (a data: URL when
   *   the image was converted); its MIME type decides the extension
   * @returns {string} name including an extension when one can be determined
   */
  function resolveDownloadName(sourceUrl, downloadUrl) {
    var name = 'image';
    try {
      var source = new URL(sourceUrl);
      if (source.protocol === 'http:' || source.protocol === 'https:') {
        name = decodeURIComponent(source.pathname.split('/').pop()) || name;
      }
    } catch (e) { /* keep the default name */ }

    if (typeof downloadUrl === 'string' && downloadUrl.indexOf('data:image/') === 0) {
      var mime = downloadUrl.match(/^data:image\/([a-z0-9.+-]+)/i);
      var ext = mime ? mime[1].split('+')[0] : 'png';
      if (ext === 'jpeg') ext = 'jpg';
      name = name.replace(/\.[^.]+$/, '') + '.' + ext;
    }
    return name;
  }

  /**
   * Resolve the final file name for a download, inferring the image extension
   * when the source URL does not carry one.
   *
   * @param {string} sourceUrl
   * @param {string} downloadUrl
   * @returns {Promise<string>} name including an extension
   */
  function resolveFinalName(sourceUrl, downloadUrl) {
    var name = resolveDownloadName(sourceUrl, downloadUrl);
    // Chrome does not add an extension to a supplied filename, so URLs like
    // /media/abc?format=jpg would otherwise save as "abc".
    if (IMAGE_EXT_RE.test(name)) return Promise.resolve(name);
    return inferImageExtension(sourceUrl).then(function (inferred) {
      return inferred ? name.replace(SCRIPT_EXT_RE, '') + '.' + inferred : name;
    });
  }

  /**
   * Build the final filename for an extension-initiated download.
   *
   * @param {object} params
   * @param {string} params.originalName — source URL basename or MIME-derived name
   * @param {string} params.url — source URL
   * @param {number} params.index — batch position
   * @param {object} [params.options] — per-request naming settings
   * @param {object} [params.storedOptions] — options kept by the worker
   * @returns {string} shaped filename (may include a subfolder path)
   */
  function shapeDownloadFilename(params) {
    params = params || {};
    var originalName = params.originalName;
    var url = params.url;
    var opts = mergeDownloadOptions(params.options, params.storedOptions);

    var saveFileAs = opts.saveFileAs || 'SYSTEM_NAME';
    var template = opts.saveFileName || '';
    var folderPref = opts.saveFolderName || '';

    // Split original name into base + extension.
    originalName = String(originalName).split(/[\\/]/).pop() || 'image';
    var parts = String(originalName).split('.');
    var ext = parts.length > 1 ? parts.pop() : '';
    var base = parts.join('.') || 'image';

    var shaped;

    if (saveFileAs === 'ORIGINAL_FILE_NAME') {
      // Preserve the source URL's basename.
      shaped = originalName || (base + (ext ? '.' + ext : ''));
    } else if (saveFileAs === 'CUSTOM_NAME') {
      // Use the token template. applyFilenameTokens handles {ext} inclusion
      // and auto-appends the extension when {ext} is absent.
      if (typeof globalThis.applyFilenameTokens === 'function') {
        shaped = globalThis.applyFilenameTokens(template, {
          name: base,
          index: params.index || extractIndexFromUrl(url),
          ext: ext,
          url: url,
          now: new Date()
        });
      } else {
        shaped = template ? template + (ext ? '.' + ext : '') : originalName;
      }
    } else {
      // SYSTEM_NAME (default): deterministic index-based name.
      var index = params.index || extractIndexFromUrl(url);
      shaped = 'imgi_' + index + '_' + originalName;
    }

    shaped = sanitizeFilename(shaped);

    // Treat user input as one folder segment, preventing invalid download paths.
    var folder = resolveSubfolder(folderPref, url);
    if (folder) folder = sanitizeFilename(folder);
    if (folder) {
      shaped = folder + '/' + shaped;
    }

    return shaped;
  }

  var api = {
    IMAGE_EXT_RE: IMAGE_EXT_RE,
    SCRIPT_EXT_RE: SCRIPT_EXT_RE,
    mergeDownloadOptions: mergeDownloadOptions,
    resolveDownloadName: resolveDownloadName,
    resolveFinalName: resolveFinalName,
    resolveSubfolder: resolveSubfolder,
    inferImageExtension: inferImageExtension,
    shapeDownloadFilename: shapeDownloadFilename
  };

  if (typeof globalThis !== 'undefined') {
    Object.keys(api).forEach(function (key) { globalThis[key] = api[key]; });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
