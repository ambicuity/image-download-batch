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
 * and the length is capped at 255 characters.
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

  // Maximum filename length on most filesystems (NTFS, ext4, APFS).
  var MAX_LENGTH = 255;

  /**
   * Truncate a string to at most `max` UTF-16 code units while never
   * splitting a surrogate pair. If truncation would leave a lone high
   * surrogate, the trailing half-pair is dropped.
   */
  function truncateSafe(value, max) {
    if (value.length <= max) {
      return value;
    }
    var cut = value.slice(0, max);
    var last = cut.charCodeAt(max - 1);
    // High surrogate range: 0xD800 - 0xDBFF. If the last unit is a high
    // surrogate, drop it to avoid emitting a lone surrogate.
    if (last >= 0xD800 && last <= 0xDBFF) {
      cut = cut.slice(0, max - 1);
    }
    return cut;
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

    // 4. Escape Windows reserved device names by appending an underscore.
    if (RESERVED_NAME.test(str)) {
      str = str + '_';
    }

    // 5. Trim trailing dots and spaces (Windows forbids them).
    str = str.replace(TRAILING_DOT_SPACE, '');

    // 6. Enforce maximum length.
    str = truncateSafe(str, MAX_LENGTH);

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