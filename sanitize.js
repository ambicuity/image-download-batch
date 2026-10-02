/*!
 * sanitize.js — Filesystem-safe filename sanitizer for
 * Image Download - Batch.
 *
 * Replaces the previous browserify bundle of `sanitize-filename` with a
 * small, self-contained implementation that preserves the same public API:
 *
 *     sanitizeFilename(input, options) -> string
 *     sanitizeFilename(input)          -> string
 *
 * where `options.replacement` (default `_`) is the character used to
 * substitute illegal characters. The result is safe across Windows, macOS,
 * and Linux: illegal chars are replaced, trailing dots/spaces are trimmed,
 * Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) are escaped,
 * and the length is capped at 255 UTF-8 bytes.
 *
 * Loaded as a <script> by popup.html and imported by background.js; exposes
 * `globalThis.sanitizeFilename` (and `self.sanitizeFilename` / `window.
 * sanitizeFilename` where applicable). Also keeps a `sanitize` alias for
 * backward compatibility with code that called the browserify export by
 * its short name.
 *
 * Original implementation for Image Download - Batch by Ritesh Rana
 */
(function () {
  'use strict';

  // Characters forbidden in filenames on Windows (and rejected by most
  // other filesystems as well): < > : " / \ | ? * and ASCII control chars.
  var ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

  // Windows reserved device names, with or without an extension.
  // CON, PRN, AUX, NUL, COM1..COM9, LPT1..LPT9
  var RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

  // Trailing dots and spaces are stripped on Windows and cause trouble on
  // other platforms too.
  var TRAILING_DOT_SPACE = /[. ]+$/;

  // Leading dots are allowed (hidden files on Unix) but a name made only of
  // dots collapses to an underscore to avoid "." and ".." path traversal.
  var ONLY_DOTS = /^\.+$/;

  // Maximum filename byte length on most filesystems (NTFS, ext4, APFS).
  var MAX_LENGTH = 255;

  /**
   * Truncate to at most `max` UTF-8 bytes without splitting a code point.
   */
  function truncateSafe(value, max) {
    var encoder = new TextEncoder();
    if (encoder.encode(value).length <= max) return value;
    var result = '', length = 0;
    for (var character of value) {
      var bytes = encoder.encode(character).length;
      if (length + bytes > max) break;
      result += character; length += bytes;
    }
    return result;
  }

  /**
   * Sanitize a filename.
   *
   * @param {string} input - The raw filename to sanitize.
   * @param {{ replacement?: string }=} options - Optional configuration.
   *     `options.replacement` overrides the `_` substitute character. An
   *     empty string is permitted and simply removes the illegal chars.
   * @returns {string} A filesystem-safe filename.
   */
  function sanitizeFilename(input, options) {
    if (input == null) {
      return '';
    }
    var str = String(input);
    var replacement = (options && typeof options.replacement === 'string')
      ? options.replacement
      : '_';

    // 1. Replace illegal characters with the replacement token.
    str = str.replace(ILLEGAL_CHARS, replacement);

    // 2. Collapse runs of the replacement when it is a single char, so
    //    "a//b" -> "a__b" doesn't accumulate noise from removed slashes.
    if (replacement.length === 1) {
      var runRegex = new RegExp(
        replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '{2,}',
        'g'
      );
      str = str.replace(runRegex, replacement);
    }

    // 3. A name composed entirely of dots is unsafe; replace it.
    str = str.replace(ONLY_DOTS, replacement || '_');

    // Trim first: "CON " must not become a reserved name after checking it.
    str = str.replace(TRAILING_DOT_SPACE, '');
    if (RESERVED_NAME.test(str)) str = '_' + str;

    // 6. Enforce maximum length.
    var extension = str.match(/\.[a-z0-9]{1,16}$/i);
    if (extension) {
      str = truncateSafe(str.slice(0, -extension[0].length), MAX_LENGTH - extension[0].length) + extension[0];
    } else str = truncateSafe(str, MAX_LENGTH);

    // 7. Re-trim trailing dots/spaces in case truncation exposed one.
    str = str.replace(TRAILING_DOT_SPACE, '');

    // 8. If everything was stripped, return a safe default.
    if (str === '' || str === replacement) {
      return replacement || '_';
    }

    return str;
  }

  // Expose on every plausible global object.
  var globals = [];
  if (typeof globalThis !== 'undefined') {
    globals.push(globalThis);
  }
  if (typeof self !== 'undefined') {
    globals.push(self);
  }
  if (typeof window !== 'undefined' && window !== globalThis) {
    globals.push(window);
  }
  if (typeof global !== 'undefined' && global !== globalThis) {
    globals.push(global);
  }

  for (var i = 0; i < globals.length; i++) {
    globals[i].sanitizeFilename = sanitizeFilename;
    // Backward-compatible alias matching the previous `sanitize` export.
    if (!globals[i].sanitize) {
      globals[i].sanitize = sanitizeFilename;
    }
  }
})();