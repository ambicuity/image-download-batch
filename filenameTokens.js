/*
 * filenameTokens.js — resolves filename templates for custom download names.
 *
 * Supported tokens (all resolvable in the service-worker context, no image
 * metadata required):
 *   {name}   original base filename (no extension)
 *   {index}  1-based download index
 *   {ext}    file extension without the dot
 *   {domain} hostname of the source URL
 *   {date}   YYYY-MM-DD (local)
 *   {time}   HH-MM-SS (local)
 *
 * Unknown tokens are left literal. The result is sanitized for filesystem
 * safety. If the template contains {ext} the extension is used inline and NOT
 * auto-appended; otherwise ".<ext>" is appended.
 *
 * Exposed as globalThis.applyFilenameTokens (importScripts in the service
 * worker) and as a CommonJS export for Node unit tests.
 */
(function () {
  // Characters not allowed in a filename segment. Dots, hyphens and spaces are
  // preserved so the extension and readable names survive.
  var ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function sanitizeSegment(value) {
    return String(value).replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim();
  }

  function applyFilenameTokens(template, ctx) {
    ctx = ctx || {};
    var tpl = String(template == null ? '' : template);
    var now = ctx.now || new Date();

    var domain = '';
    if (ctx.url) {
      try { domain = new URL(ctx.url).hostname || ''; } catch (e) { domain = ''; }
    }

    var indexStr = ctx.index != null ? String(ctx.index) : '';
    var values = {
      name: ctx.name != null ? String(ctx.name) : '',
      index: indexStr,
      ext: ctx.ext != null ? String(ctx.ext) : '',
      domain: domain,
      host: domain,
      date: now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate()),
      time: two(now.getHours()) + '-' + two(now.getMinutes()) + '-' + two(now.getSeconds()),
      year: String(now.getFullYear()),
      month: two(now.getMonth() + 1),
      day: two(now.getDate()),
      timestamp: String(Math.floor(now.getTime() / 1000))
    };

    var hasExtToken = /\{ext\}/.test(tpl);
    // Zero-padded index first: {index:N} -> index left-padded with zeros to width N.
    var resolved = tpl.replace(/\{index:(\d+)\}/g, function (_m, width) {
      var s = indexStr;
      var w = parseInt(width, 10);
      while (s.length < w) s = '0' + s;
      return s;
    });
    resolved = resolved.replace(/\{(name|index|ext|domain|host|date|time|year|month|day|timestamp)\}/g, function (_m, key) {
      return values[key];
    });
    resolved = sanitizeSegment(resolved);

    var ext = sanitizeSegment(values.ext);
    if (!hasExtToken && ext) resolved = resolved + '.' + ext;

    if (!resolved || resolved === '.' + ext) {
      var fallback = sanitizeSegment(ctx.name || 'image');
      resolved = ext ? fallback + '.' + ext : fallback;
    }
    return resolved;
  }

  if (typeof globalThis !== 'undefined') globalThis.applyFilenameTokens = applyFilenameTokens;
  if (typeof module !== 'undefined' && module.exports) module.exports = { applyFilenameTokens: applyFilenameTokens };
})();
