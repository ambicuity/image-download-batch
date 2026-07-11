// Unit tests for flattenDedupeImages, extracted from the SHIPPED contextMenu.js.
// Run: node docs/superpowers/tests/flattenDedupeImages.test.cjs
const fs = require('fs');
const path = require('path');
const EXT_ROOT = path.resolve(__dirname, '..', '..', '..');
const src = fs.readFileSync(path.join(EXT_ROOT, 'contextMenu.js'), 'utf8');

const START = '/* __FLATTEN_START__ */';
const END = '/* __FLATTEN_END__ */';
const a = src.indexOf(START), b = src.indexOf(END);
if (a === -1 || b === -1) {
  console.error('FAIL: flattenDedupeImages markers not found in contextMenu.js');
  process.exit(1);
}
const snippet = src.slice(a + START.length, b);
const flattenDedupeImages = (function () { eval(snippet); return flattenDedupeImages; })();

const cases = [
  ['flatten + dedupe across frames',
    [{ result: { images: ['a', 'b'] } }, { result: { images: ['b', 'c'] } }], ['a', 'b', 'c']],
  ['skip null frames and null results',
    [null, { result: null }, { result: { images: ['x'] } }], ['x']],
  ['skip non-array images',
    [{ result: { images: 'nope' } }, { result: { images: ['y'] } }], ['y']],
  ['empty input -> empty',
    [], []],
  ['non-array input -> empty (no crash)',
    null, []],
  ['filter non-string / empty entries',
    [{ result: { images: ['a', null, 5, '', 'b'] } }], ['a', 'b']],
  ['preserve first-seen order',
    [{ result: { images: ['z', 'a'] } }, { result: { images: ['a', 'z', 'm'] } }], ['z', 'a', 'm']],
];

let pass = 0, fail = 0;
for (const [desc, input, expected] of cases) {
  let got;
  try { got = flattenDedupeImages(input); } catch (e) { got = 'THREW: ' + e.message; }
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log((ok ? 'PASS' : 'FAIL'), '-', desc);
  if (!ok) console.log('   got', JSON.stringify(got), 'expected', JSON.stringify(expected));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
