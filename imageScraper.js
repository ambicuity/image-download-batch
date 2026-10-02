/**
 * Original implementation for Image Download - Batch by Ritesh Rana.
 *
 * Content script injected into web pages (via chrome.scripting.executeScript
 * with allFrames: true) to discover every image on the page.  Returns a
 * Promise that resolves to { images, title, isTop, origin, isArc }.
 *
 * No external dependencies.  No source maps.  ES2015+.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** Image file extensions used for <a> link and raw-URL discovery. */
  var IMAGE_EXTENSIONS = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg',
    'bmp', 'ico', 'tif', 'tiff', 'jfif', 'heic', 'heif'
  ];

  /** <link> rel values that point to an image resource. */
  var IMAGE_LINK_RELS = [
    'image_src', 'icon', 'apple-touch-icon', 'apple-touch-icon-precomposed',
    'mask-icon', 'shortcut icon', 'fluid-icon'
  ];

  // ---------------------------------------------------------------------------
  // Deduplication helper
  // ---------------------------------------------------------------------------

  /**
   * Ordered set: add a URL only the first time it is seen.
   * Returns true if the URL was newly added.
   */
  function makeUrlRegistry() {
    var seen = Object.create(null);
    return {
      add: function (url) {
        if (typeof url !== 'string' || url.length === 0) return false;
        // Normalise very slightly so identical resources aren't duplicated
        // by trivial whitespace differences.
        var key = url.trim();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------------

  /** Resolve a possibly-relative URL against the document base. */
  function resolveUrl(url) {
    if (!url) return '';
    try {
      return new URL(url, document.baseURI).href;
    } catch (e) {
      return url;
    }
  }

  /** True when *url* is a data: URI (left untouched by the upgrader). */
  function isDataUri(url) {
    return typeof url === 'string' && url.slice(0, 5) === 'data:';
  }

  /** True when the URL pathname ends with a known image extension. */
  function hasImageExtension(url) {
    if (!url || isDataUri(url)) return false;
    try {
      var path = new URL(url, document.baseURI).pathname.toLowerCase();
      return IMAGE_EXTENSIONS.some(function (ext) {
        return path.endsWith('.' + ext);
      });
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Prefer-full-resolution URL upgrade
  //
  // The block between the __UPGRADE_START__ / __UPGRADE_END__ markers is
  // self-contained (no closure or DOM dependencies) so it can be extracted and
  // unit-tested in Node — see docs/superpowers/tests/upgradeToLargest.test.cjs.
  // ---------------------------------------------------------------------------

  /* __UPGRADE_START__ */
  // Query params that only control sizing/format; safe to drop for full-res.
  var SIZE_PARAMS = {
    w: 1, h: 1, width: 1, height: 1, fit: 1, crop: 1, quality: 1, q: 1,
    dpr: 1, resize: 1, size: 1, maxwidth: 1, maxheight: 1, mw: 1, mh: 1,
    wid: 1, hei: 1, sz: 1, imwidth: 1, fm: 1, format: 1, auto: 1, ar: 1, g: 1
  };

  function isUpgradeDataUri(raw) {
    return typeof raw === 'string' && raw.slice(0, 5) === 'data:';
  }

  // A Cloudinary transformation segment is a comma-separated list of
  // `key_value` tokens containing at least one digit (e.g. "w_300,h_200,c_fill").
  // Plain folders ("my_folder") and version segments ("v1234") have no such
  // shape and are preserved.
  function isCloudinaryTransform(segment) {
    if (!/\d/.test(segment)) return false;
    return segment.split(',').every(function (tok) {
      return /^[a-z]+_[^,]+$/i.test(tok);
    });
  }

  /**
   * Rewrite a single URL toward its largest original. Data URIs and
   * unparseable strings pass through untouched. @Nx density suffixes are
   * left in place — upgradeToLargest collapses base/retina variants later.
   */
  function upgradeUrl(rawUrl) {
    if (!rawUrl || isUpgradeDataUri(rawUrl)) return rawUrl;
    var base = (typeof document !== 'undefined' && document.baseURI)
      ? document.baseURI : undefined;
    var url;
    try {
      url = new URL(rawUrl, base);
    } catch (e) {
      return rawUrl;
    }

    // Signed CDN URLs authenticate the exact path/query; rewriting breaks access.
    var signed = false;
    url.searchParams.forEach(function (_value, key) {
      if (/^(?:sig|signature|token|auth|authorization|expires|policy|key-pair-id|x-amz-.+|x-goog-.+)$/i.test(key)) signed = true;
    });
    if (signed || /\/s--[^/]+--\//.test(url.pathname)) return rawUrl;

    // 1. Drop sizing/format query params (case-insensitive).
    var toDelete = [];
    url.searchParams.forEach(function (_value, key) {
      if (SIZE_PARAMS[key.toLowerCase()]) toDelete.push(key);
    });
    toDelete.forEach(function (key) { url.searchParams.delete(key); });

    // 2. Cloudinary: strip leading transform segments after `/upload/`,
    //    preserving version ("v1234") and folder segments.
    if (/cloudinary/i.test(url.hostname)) {
      var segs = url.pathname.split('/');
      var up = segs.indexOf('upload');
      if (up !== -1) {
        var s = up + 1;
        while (s < segs.length - 1 && isCloudinaryTransform(segs[s])) {
          segs.splice(s, 1);
        }
        url.pathname = segs.join('/');
      }
    }

    // 3. WordPress / Shopify size suffix: pic-300x200.jpg -> pic.jpg
    //    ("photo-2020.jpg" is untouched — it needs the NxN shape).
    url.pathname = url.pathname.replace(/[-_]\d+x\d+(?=\.\w+$)/i, '');

    // 4. Thumbnail directory segments (but not "/small-business/").
    url.pathname = url.pathname.replace(/\/(?:thumbs?|thumbnails?|small)\//gi, '/');

    // Drop the fragment — it never changes the resource.
    url.hash = '';
    return url.href;
  }

  // Retina density (@2x/@3x) of a URL plus the density-stripped "family" key
  // so base and retina variants of the same image group together.
  function retinaInfo(href) {
    var m = href.match(/@(\d+)x(?=\.[a-z0-9]+($|\?|#))/i);
    if (!m) return { density: 1, key: href };
    return {
      density: parseInt(m[1], 10),
      key: href.slice(0, m.index) + href.slice(m.index + m[0].length)
    };
  }

  /**
   * Upgrade every URL, then collapse base/retina variants of the same image
   * to the highest-density one, keeping first-seen order and deduping.
   */
  function upgradeToLargest(urls) {
    if (!Array.isArray(urls)) return [];
    var out = [];
    var byFamily = Object.create(null);
    for (var i = 0; i < urls.length; i++) {
      var raw = urls[i];
      if (typeof raw !== 'string' || !raw) continue;
      var upgraded = upgradeUrl(raw);
      var info = retinaInfo(upgraded);
      var prev = byFamily[info.key];
      if (prev === undefined) {
        byFamily[info.key] = { index: out.length, density: info.density };
        out.push(upgraded);
      } else if (info.density > prev.density) {
        out[prev.index] = upgraded;
        prev.density = info.density;
      }
    }
    return out;
  }
  /* __UPGRADE_END__ */

  // ---------------------------------------------------------------------------
  // Srcset parser
  // ---------------------------------------------------------------------------

  /**
   * Parse a srcset attribute into a list of candidate URLs, following the
   * HTML candidate grammar: a URL is a run of non-whitespace characters, so
   * commas inside it (Cloudinary "w_300,c_fill", data URIs) are preserved.
   * Candidates are separated by a comma after the descriptors, or by a comma
   * ending the URL itself.
   */
  function parseSrcset(srcset) {
    var candidates = [];
    if (!srcset || typeof srcset !== 'string') return candidates;
    var pos = 0;
    var len = srcset.length;
    while (pos < len) {
      // Skip leading whitespace and separator commas.
      while (pos < len && /[\s,]/.test(srcset[pos])) pos++;
      if (pos >= len) break;
      var start = pos;
      while (pos < len && !/\s/.test(srcset[pos])) pos++;
      var url = srcset.slice(start, pos);
      if (/,$/.test(url)) {
        // A trailing comma ends this candidate; it has no descriptors.
        url = url.replace(/,+$/, '');
      } else {
        // Skip descriptors (1x, 300w) up to the next comma outside parens.
        var depth = 0;
        while (pos < len) {
          var ch = srcset[pos];
          if (ch === '(') depth++;
          else if (ch === ')') depth = Math.max(0, depth - 1);
          else if (ch === ',' && depth === 0) break;
          pos++;
        }
      }
      if (url) candidates.push(url);
    }
    return candidates;
  }

  // ---------------------------------------------------------------------------
  // CSS background-image extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract every url(...) value from a CSS background / background-image
   * declaration string.
   */
  function extractBackgroundUrls(cssValue) {
    var urls = [];
    if (!cssValue) return urls;
    // Matches url("..."), url('...') and url(...). Quoted values may contain
    // the other quote character and parentheses (inline SVG data URIs) and
    // backslash escapes, which computed styles use for embedded quotes.
    var re = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^"'()\s]+))\s*\)/gi;
    var match;
    while ((match = re.exec(cssValue)) !== null) {
      var raw = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3];
      if (raw) urls.push(raw.replace(/\\(.)/g, '$1'));
    }
    return urls;
  }

  // ---------------------------------------------------------------------------
  // SVG serialisation
  // ---------------------------------------------------------------------------

  /** Serialise an inline <svg> element to a base64 data URL. */
  function svgToDataUri(svg) {
    try {
      // Clone so we don't mutate the live DOM.
      var clone = svg.cloneNode(true);
      // Ensure xmlns is present (required for standalone parsing).
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      var serializer = new XMLSerializer();
      var source = serializer.serializeToString(clone);
      // Use unescape/encodeURIComponent for safe base64 encoding of UTF-8.
      var encoded = btoa(unescape(encodeURIComponent(source)));
      return 'data:image/svg+xml;base64,' + encoded;
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Shadow DOM walker
  // ---------------------------------------------------------------------------

  /**
   * Recursively walk every element inside shadow roots (and nested shadow
   * roots) calling *callback* with each discovered Element.
   */
  function walkShadowTrees(root, callback) {
    if (!root) return;
    try {
      var elements = root.querySelectorAll('*');
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        callback(el);
        if (el.shadowRoot) {
          walkShadowTrees(el.shadowRoot, callback);
        }
      }
    } catch (e) {
      // Some shadow roots may be closed or throw on access — skip silently.
    }
  }

  // ---------------------------------------------------------------------------
  // Tracking-pixel filter
  // ---------------------------------------------------------------------------

  /**
   * Return true when an <img> element is a tracking pixel
   * (both naturalWidth and naturalHeight are <= 1).
   */
  function isTrackingPixel(img) {
    try {
      return img.complete && img.naturalWidth === 1 && img.naturalHeight === 1;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Main collector
  // ---------------------------------------------------------------------------

  /**
   * Discover all images on the page and return a deduplicated array of URLs.
   */
  function discoverImages() {
    var registry = makeUrlRegistry();
    var collected = [];

    function add(url) {
      var resolved = resolveUrl(url);
      if (registry.add(resolved)) collected.push(resolved);
    }

    // --- 1. <img> tags (including lazy-load data-* attributes) -------------
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (isTrackingPixel(img)) continue;

      // Primary source.
      var src = img.currentSrc || img.src;
      if (src) add(src);

      // Lazy-loading fallback attributes.
      var lazyAttrs = ['data-src', 'data-original', 'data-lazy', 'lazy-src',
                       'data-srcset', 'data-lazy-srcset'];
      for (var a = 0; a < lazyAttrs.length; a++) {
        var val = img.getAttribute(lazyAttrs[a]);
        if (!val) continue;
        if (lazyAttrs[a].indexOf('srcset') !== -1) {
          var srcsetUrls = parseSrcset(val);
          for (var s = 0; s < srcsetUrls.length; s++) add(srcsetUrls[s]);
        } else {
          add(val);
        }
      }

      // srcset attribute.
      if (img.srcset) {
        var candidates = parseSrcset(img.srcset);
        for (var c = 0; c < candidates.length; c++) add(candidates[c]);
      }
    }

    // --- 2. <picture> <source> srcset ------------------------------------
    var sources = document.querySelectorAll('picture source[srcset]');
    for (var si = 0; si < sources.length; si++) {
      var parsed = parseSrcset(sources[si].getAttribute('srcset') || '');
      for (var sp = 0; sp < parsed.length; sp++) add(parsed[sp]);
    }

    // --- 3. Open Graph / Twitter card meta tags ---------------------------
    var metaSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[property="og:image:secure_url"]',
      'meta[property="twitter:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]'
    ];
    for (var m = 0; m < metaSelectors.length; m++) {
      var meta = document.querySelector(metaSelectors[m]);
      if (meta) {
        var content = meta.getAttribute('content');
        if (content) add(content);
      }
    }

    // --- 4. <video poster> attributes ------------------------------------
    var videos = document.querySelectorAll('video[poster]');
    for (var v = 0; v < videos.length; v++) {
      var poster = videos[v].getAttribute('poster');
      if (poster) add(poster);
    }

    // --- 5. Image-bearing <link> tags ------------------------------------
    var links = document.querySelectorAll('link[href]');
    for (var li = 0; li < links.length; li++) {
      var link = links[li];
      var rel = (link.getAttribute('rel') || '').toLowerCase();
      var asAttr = (link.getAttribute('as') || '').toLowerCase();
      var isImageLink = false;

      if (IMAGE_LINK_RELS.indexOf(rel) !== -1) isImageLink = true;
      if (rel === 'preload' && asAttr === 'image') isImageLink = true;
      if (!isImageLink && hasImageExtension(link.href)) isImageLink = true;

      if (isImageLink) add(link.href);
    }

    // --- 6. <object> / <embed> with image type or extension ---------------
    var objects = document.querySelectorAll('object[data], embed[src]');
    for (var oi = 0; oi < objects.length; oi++) {
      var obj = objects[oi];
      var dataUrl = obj.getAttribute('data') || obj.getAttribute('src') || '';
      var type = (obj.getAttribute('type') || '').toLowerCase();
      if (type.indexOf('image/') === 0 || hasImageExtension(dataUrl)) {
        add(dataUrl);
      }
    }

    // --- 7. SVG <image> elements (href and xlink:href) -------------------
    var svgImages = document.querySelectorAll('svg image');
    for (var xi = 0; xi < svgImages.length; xi++) {
      var svgImg = svgImages[xi];
      var href = svgImg.getAttribute('href') || svgImg.getAttributeNS(
        'http://www.w3.org/1999/xlink', 'href');
      if (href) add(href);
    }

    // --- 8. Inline <svg> tags -> base64 data URL -------------------------
    var inlineSvgs = document.querySelectorAll('svg');
    for (var sv = 0; sv < inlineSvgs.length; sv++) {
      // Only serialise root-level <svg> elements (avoid re-serialising
      // nested <svg> fragments already captured above).
      if (inlineSvgs[sv].parentNode && inlineSvgs[sv].parentNode.nodeName
          === 'svg') continue;
      var dataUri = svgToDataUri(inlineSvgs[sv]);
      if (dataUri) add(dataUri);
    }

    // --- 9. CSS background-image on all elements -------------------------
    try {
      var allElements = document.querySelectorAll('*');
      for (var ei = 0; ei < allElements.length; ei++) {
        var el = allElements[ei];
        var style = getComputedStyle(el);
        if (!style) continue;
        var bgImage = style.getPropertyValue('background-image');
        if (bgImage && bgImage !== 'none') {
          var bgUrls = extractBackgroundUrls(bgImage);
          for (var bi = 0; bi < bgUrls.length; bi++) add(bgUrls[bi]);
        }
        // Also check the shorthand `background` property.
        var bg = style.getPropertyValue('background');
        if (bg && bg.indexOf('url(') !== -1) {
          var bgShorthandUrls = extractBackgroundUrls(bg);
          for (var bs = 0; bs < bgShorthandUrls.length; bs++) {
            add(bgShorthandUrls[bs]);
          }
        }
      }
    } catch (e) {
      // getComputedStyle can throw on detached elements — skip.
    }

    // --- 10. <a> links ending in image extensions -----------------------
    var anchors = document.querySelectorAll('a[href]');
    for (var ai = 0; ai < anchors.length; ai++) {
      var href = anchors[ai].href;
      if (hasImageExtension(href)) add(href);
    }

    // --- 11. Raw image URLs found in page HTML via regex -----------------
    try {
      var html = document.documentElement.outerHTML;
      if (html) {
        // Match src/href/content/poster/data attribute values ending in
        // image extensions, as well as bare http(s) image URLs.
        var rawRe = /https?:\/\/[^\s"'<>)]+\.(?:jpeg|jpg|png|gif|webp|avif|svg|bmp|ico|tiff|tif|jfif|heic|heif)(?=[?#\s\"'<>)]|$)(?:\?[^\s\"'<>)#]*)?(?:#[^\s\"'<>)]*)?/gi;
        var rawMatch;
        while ((rawMatch = rawRe.exec(html)) !== null) {
          add(rawMatch[0].replace(/&amp;/g, '&'));
        }
      }
    } catch (e) {
      // Reading outerHTML is safe but regex on huge pages can be slow.
    }

    // --- 12. Shadow DOM — recursively traverse for <img> and CSS ---------
    walkShadowTrees(document.body, function (el) {
      if (el.nodeName === 'IMG' && !isTrackingPixel(el)) {
        var s = el.currentSrc || el.src;
        if (s) add(s);
        if (el.srcset) {
          var sc = parseSrcset(el.srcset);
          for (var scIdx = 0; scIdx < sc.length; scIdx++) add(sc[scIdx]);
        }
      }
      try {
        var ss = getComputedStyle(el);
        if (ss) {
          var bi = ss.getPropertyValue('background-image');
          if (bi && bi !== 'none') {
            var bu = extractBackgroundUrls(bi);
            for (var buIdx = 0; buIdx < bu.length; buIdx++) add(bu[buIdx]);
          }
        }
      } catch (e) {}
    });

    return collected;
  }

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------

  function buildResult() {
    var result = {
      images: discoverImages(),
      title: document.title || '',
      isTop: window.top === window.self,
      origin: window.location.origin
    };

    // Detect Arc browser's custom CSS variable (used by the popup for theming).
    try {
      var arcVar = getComputedStyle(document.documentElement)
        .getPropertyValue('--arc-palette-title');
      if (arcVar) result.isArc = arcVar;
    } catch (e) {
      // non-Arc browsers — fine.
    }

    return result;
  }

  /**
   * The injected function returns a thenable.  chrome.scripting.executeScript
   * (MV3) awaits the resolved value and passes it back as `result` to the
   * caller.  We read the "prefer full resolution" preference from
   * chrome.storage.local and upgrade URLs when enabled.
   */
  return new Promise(function (resolve) {
    var result = buildResult();

    function finish() {
      resolve(result);
    }

    try {
      chrome.storage.local.get('imgdl_preferFullRes', function (cfg) {
        try {
          if (cfg && cfg.imgdl_preferFullRes && result.images) {
            result.images = upgradeToLargest(result.images);
          }
        } catch (e) {
          // Upgrade failure must never break scraping.
        }
        finish();
      });
    } catch (e) {
      // chrome.storage may be unavailable in some contexts — still resolve.
      finish();
    }
  });
})();