// Unit tests for dedupeUrls, extracted from the SHIPPED popup-bridge.js.
// Run: node docs/superpowers/tests/dedupeUrls.test.cjs
const fs = require('fs');
const path = require('path');
const EXT_ROOT = path.resolve(__dirname, '..', '..', '..');
const src = fs.readFileSync(path.join(EXT_ROOT, 'popup-bridge.js'), 'utf8');

const START = '/* __DEDUPE_START__ */';
const END = '/* __DEDUPE_END__ */';
const a = src.indexOf(START), b = src.indexOf(END);
if (a === -1 || b === -1) {
  console.error('FAIL: dedupeUrls markers not found in popup-bridge.js');
  process.exit(1);
}
const snippet = src.slice(a + START.length, b);
const dedupeUrls = (function () { eval(snippet); return dedupeUrls; })();

const cases = [
  ['dedupe first-seen', ['a', 'b', 'a', 'c'], ['a', 'b', 'c']],
  ['drop falsy and non-strings', ['a', null, '', 'b', undefined, 5, 'a'], ['a', 'b']],
  ['empty -> empty', [], []],
  ['non-array -> empty (no crash)', null, []],
  ['trims whitespace-only out', ['  ', 'x', 'x'], ['x']],
];

let pass = 0, fail = 0;
for (const [desc, input, expected] of cases) {
  let got;
  try { got = dedupeUrls(input); } catch (e) { got = 'THREW: ' + e.message; }
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log((ok ? 'PASS' : 'FAIL'), '-', desc);
  if (!ok) console.log('   got', JSON.stringify(got), 'expected', JSON.stringify(expected));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
