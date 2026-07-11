// Node unit tests for upgradeToLargest, extracted from the SHIPPED imageScraper.js
// so the test guards the real code. Run:
//   node docs/superpowers/tests/upgradeToLargest.test.cjs
const fs = require('fs');
const path = require('path');
const EXT_ROOT = path.resolve(__dirname, '..', '..', '..');
const src = fs.readFileSync(path.join(EXT_ROOT, 'imageScraper.js'), 'utf8');

const START = '/* __UPGRADE_START__ */';
const END = '/* __UPGRADE_END__ */';
const a = src.indexOf(START), b = src.indexOf(END);
if (a === -1 || b === -1) {
  console.error('FAIL: upgradeToLargest markers not found in imageScraper.js');
  process.exit(1);
}
const snippet = src.slice(a + START.length, b);
const upgradeToLargest = (function () { eval(snippet); return upgradeToLargest; })();

const cases = [
  ['strip w param',
    ['https://x.com/i.jpg?w=200'], ['https://x.com/i.jpg']],
  ['strip size params, keep others',
    ['https://x.com/i.jpg?w=200&h=100&id=5'], ['https://x.com/i.jpg?id=5']],
  ['collapse ?w variants to one',
    ['https://x.com/i.jpg?w=200', 'https://x.com/i.jpg?w=800'], ['https://x.com/i.jpg']],
  ['WordPress -WxH suffix removed',
    ['https://x.com/pic-300x200.jpg'], ['https://x.com/pic.jpg']],
  ['WP variant collapses with original, first-seen order',
    ['https://x.com/pic-150x150.jpg', 'https://x.com/pic.jpg'], ['https://x.com/pic.jpg']],
  ['year-like suffix NOT stripped',
    ['https://x.com/photo-2020.jpg'], ['https://x.com/photo-2020.jpg']],
  ['thumb directory rewritten',
    ['https://x.com/thumb/a.jpg'], ['https://x.com/a.jpg']],
  ['thumbnails directory rewritten',
    ['https://x.com/thumbnails/a.jpg'], ['https://x.com/a.jpg']],
  ['/small-business/ NOT treated as thumb dir',
    ['https://x.com/small-business/logo.jpg'], ['https://x.com/small-business/logo.jpg']],
  ['data URI untouched',
    ['data:image/png;base64,AAAA'], ['data:image/png;base64,AAAA']],
  ['non-size query preserved',
    ['https://x.com/i.jpg?id=5'], ['https://x.com/i.jpg?id=5']],
  ['preserve order + dedupe across variants',
    ['https://x.com/b.jpg?w=1', 'https://x.com/a.jpg', 'https://x.com/b.jpg'],
    ['https://x.com/b.jpg', 'https://x.com/a.jpg']],
  ['emptied query drops the ?',
    ['https://x.com/i.jpg?w=1&h=2'], ['https://x.com/i.jpg']],
  ['invalid url passthrough (no crash)',
    ['not a url'], ['not a url']],
  ['case-insensitive param names',
    ['https://x.com/i.jpg?W=200&Fit=crop'], ['https://x.com/i.jpg']],
  // ---- batch 4: smarter CDN patterns ----
  ['Cloudinary transform segment stripped',
    ['https://res.cloudinary.com/demo/image/upload/w_300,h_200,c_fill/sample.jpg'],
    ['https://res.cloudinary.com/demo/image/upload/sample.jpg']],
  ['Cloudinary transform kept before version',
    ['https://res.cloudinary.com/demo/image/upload/w_300/v1234/sample.jpg'],
    ['https://res.cloudinary.com/demo/image/upload/v1234/sample.jpg']],
  ['Cloudinary public id with underscore NOT stripped (no digit)',
    ['https://res.cloudinary.com/demo/image/upload/my_folder/sample.jpg'],
    ['https://res.cloudinary.com/demo/image/upload/my_folder/sample.jpg']],
  ['no transform after /upload/ -> unchanged',
    ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
    ['https://res.cloudinary.com/demo/image/upload/sample.jpg']],
  ['Shopify-style _WxH suffix stripped',
    ['https://cdn.shopify.com/s/files/1/img_600x400.jpg'],
    ['https://cdn.shopify.com/s/files/1/img.jpg']],
  ['_WxH stripped, non-size query kept',
    ['https://cdn.shopify.com/img_600x400.jpg?v=123'],
    ['https://cdn.shopify.com/img.jpg?v=123']],
  ['Scene7 wid/hei stripped',
    ['https://x.com/i.jpg?wid=200&hei=100'], ['https://x.com/i.jpg']],
  ['maxwidth + fm + auto stripped',
    ['https://x.com/i.jpg?maxwidth=200&fm=webp&auto=format'], ['https://x.com/i.jpg']],
  ['imgix w+fit+auto stripped',
    ['https://x.imgix.net/i.jpg?w=200&fit=crop&auto=format'], ['https://x.imgix.net/i.jpg']],
  // ---- batch 5: retina @Nx preference (keep the larger, don't strip it) ----
  ['prefer @2x over base, collapse to one',
    ['https://x.com/photo.jpg', 'https://x.com/photo@2x.jpg'], ['https://x.com/photo@2x.jpg']],
  ['lone @2x kept unchanged',
    ['https://x.com/photo@2x.jpg'], ['https://x.com/photo@2x.jpg']],
  ['prefer highest density @3x',
    ['https://x.com/photo@3x.jpg', 'https://x.com/photo@2x.jpg', 'https://x.com/photo.jpg'],
    ['https://x.com/photo@3x.jpg']],
  ['@2x with downscale param -> param stripped, @2x kept',
    ['https://x.com/photo@2x.jpg?w=200'], ['https://x.com/photo@2x.jpg']],
  ['@2x with non-size query preserved',
    ['https://x.com/a@2x.png?v=1'], ['https://x.com/a@2x.png?v=1']],
  ['base seen first, @2x seen later still wins',
    ['https://x.com/p.jpg', 'https://x.com/q.jpg', 'https://x.com/p@2x.jpg'],
    ['https://x.com/p@2x.jpg', 'https://x.com/q.jpg']],
];

let pass = 0, fail = 0;
for (const [desc, input, expected] of cases) {
  let got;
  try { got = upgradeToLargest(input); } catch (e) { got = 'THREW: ' + e.message; }
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log((ok ? 'PASS' : 'FAIL'), '-', desc);
  if (!ok) console.log('   in=' + JSON.stringify(input), '=> got', JSON.stringify(got), 'expected', JSON.stringify(expected));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
