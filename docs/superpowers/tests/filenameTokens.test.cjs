// Node unit tests for applyFilenameTokens.
// Run: node docs/superpowers/tests/filenameTokens.test.cjs
// The extension file is a browser IIFE; a parent package.json sets
// "type":"module", so we eval it rather than require() it.
const fs = require('fs');
const path = require('path');
const EXT_ROOT = path.resolve(__dirname, '..', '..', '..');
eval(fs.readFileSync(path.join(EXT_ROOT, 'filenameTokens.js'), 'utf8'));
const applyFilenameTokens = globalThis.applyFilenameTokens;

const fixedNow = new Date(2026, 6, 11, 9, 8, 7); // local: 2026-07-11 09:08:07

const cases = [
  ['plain name + ext appended',
    ['{name}', { name: 'photo', ext: 'jpg' }], 'photo.jpg'],
  ['name and index',
    ['{name}-{index}', { name: 'photo', index: 3, ext: 'jpg' }], 'photo-3.jpg'],
  ['explicit {ext} token is not double-appended',
    ['{name}.{ext}', { name: 'photo', ext: 'jpg' }], 'photo.jpg'],
  ['{ext} token mid-string, no auto-append',
    ['{name}-{ext}-copy', { name: 'photo', ext: 'png' }], 'photo-png-copy'],
  ['domain from url',
    ['{domain}-{index}', { name: 'x', index: 1, ext: 'jpg', url: 'https://cdn.example.com/a/b.jpg?w=200' }],
    'cdn.example.com-1.jpg'],
  ['date token',
    ['{date}_{name}', { name: 'photo', ext: 'png', now: fixedNow }], '2026-07-11_photo.png'],
  ['time token',
    ['{time}', { name: 'x', ext: 'jpg', now: fixedNow }], '09-08-07.jpg'],
  ['unknown token left literal',
    ['{foo}-{name}', { name: 'photo', ext: 'jpg' }], '{foo}-photo.jpg'],
  ['slash in resolved value is sanitized',
    ['{name}', { name: 'a/b', ext: 'jpg' }], 'a_b.jpg'],
  ['illegal filename chars sanitized (keep dots/hyphens)',
    ['{name}:v*1', { name: 'img', ext: 'png' }], 'img_v_1.png'],
  ['hyphens and spaces are preserved',
    ['{name} shot-01', { name: 'beach', ext: 'jpg' }], 'beach shot-01.jpg'],
  ['index 0 prints as 0',
    ['{name}-{index}', { name: 'p', index: 0, ext: 'jpg' }], 'p-0.jpg'],
  ['degenerate template keeps literal, still gets ext',
    ['{bogus}', { name: '', ext: 'jpg' }], '{bogus}.jpg'],
  ['missing url -> empty domain, still valid',
    ['{domain}{name}', { name: 'p', ext: 'jpg' }], 'p.jpg'],
  // ---- batch 2: richer tokens ----
  ['year/month/day tokens',
    ['{year}{month}{day}', { name: 'x', ext: 'jpg', now: fixedNow }], '20260711.jpg'],
  ['host is an alias for domain',
    ['{host}', { name: 'x', ext: 'jpg', url: 'https://cdn.example.com/a.jpg' }], 'cdn.example.com.jpg'],
  ['timestamp token (epoch seconds)',
    ['{timestamp}', { name: 'x', ext: 'jpg', now: fixedNow }], String(Math.floor(fixedNow.getTime() / 1000)) + '.jpg'],
  ['padded {index:3}',
    ['{name}-{index:3}', { name: 'p', index: 5, ext: 'jpg' }], 'p-005.jpg'],
  ['padded {index:2}',
    ['{index:2}', { name: 'p', index: 7, ext: 'jpg' }], '07.jpg'],
  ['padded index does not truncate when wider than pad',
    ['{index:3}', { name: 'p', index: 1234, ext: 'jpg' }], '1234.jpg'],
  ['padded {index:3} of 0',
    ['{index:3}', { name: 'p', index: 0, ext: 'jpg' }], '000.jpg'],
];

let pass = 0, fail = 0;
for (const [desc, [tpl, ctx], expected] of cases) {
  let got;
  try { got = applyFilenameTokens(tpl, ctx); } catch (e) { got = 'THREW: ' + e.message; }
  const ok = got === expected;
  console.log((ok ? 'PASS' : 'FAIL'), '-', desc);
  if (!ok) console.log('   tpl=' + JSON.stringify(tpl), '=> got', JSON.stringify(got), 'expected', JSON.stringify(expected));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
