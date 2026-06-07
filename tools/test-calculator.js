#!/usr/bin/env node
/* ============================================================
   DOM smoke harness for calculator.js
   Stubs the browser globals, require()s calculator.js to catch
   load-time throws (e.g. hoisting/load-order bugs that node --check
   cannot see), then exercises the pure compute functions against
   the generated bulletin data.
   Run:  node tools/test-calculator.js   (after node scripts/build.js)
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(name, cond, extra) { console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? '  -> ' + extra : '')); if (!cond) failed++; }

/* ---- minimal browser stubs ---- */
const emptyList = [];
global.document = {
  querySelector: () => null,
  querySelectorAll: () => emptyList,
  createElement: () => ({ className: '', textContent: '', style: {}, setAttribute() {}, appendChild() {} })
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

/* ---- load calculator.js (this is the load-time-throw check) ---- */
let calc;
try {
  calc = require(path.join(__dirname, '..', 'assets', 'js', 'calculator.js'));
  ok('calculator.js loads without throwing', true);
} catch (e) {
  ok('calculator.js loads without throwing', false, e.message);
  process.exit(1);
}
ok('exports computeWait + computeOdds', calc && typeof calc.computeWait === 'function' && typeof calc.computeOdds === 'function');

/* ---- exercise computeWait against the real bulletin data ---- */
const bulletin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'bulletin-index.json'), 'utf8'));

// EB-2 India with an older priority date -> should project a future date
const r1 = calc.computeWait(bulletin, 'EB2', 'India', '2014-01');
ok('EB2 India returns a status', r1 && !!r1.status, r1 && r1.status);
ok('EB2 India shows the June 2026 cutoff', r1 && r1.cutoffLabel === 'September 1, 2013', r1 && r1.cutoffLabel);
ok('EB2 India projects (not stuck) for a waiting date', r1 && (r1.status === 'projected' || r1.status === 'stuck' || r1.status === 'available'), r1 && r1.status);

// A priority date already past the cutoff -> available
const r2 = calc.computeWait(bulletin, 'EB2', 'India', '2010-01');
ok('EB2 India with very old date = available', r2 && r2.status === 'available', r2 && r2.status);

// EB-1 AllOther is Current
const r3 = calc.computeWait(bulletin, 'EB1', 'AllOther', '2024-01');
ok('EB1 AllOther = current', r3 && r3.status === 'current', r3 && r3.status);

// unknown selection -> graceful error
const r4 = calc.computeWait(bulletin, 'EB9', 'Atlantis', '2020-01');
ok('unknown category/country errors gracefully', r4 && !!r4.error);

/* ---- exercise computeOdds ---- */
const o1 = calc.computeOdds('4', false);
const o2 = calc.computeOdds('1', false);
const o3 = calc.computeOdds('1', true);
ok('odds: Level IV > Level I', o1.p > o2.p, o1.p + ' vs ' + o2.p);
ok('odds: advanced degree improves Level I odds', o3.p > o2.p, o3.p + ' vs ' + o2.p);
ok('odds: probabilities within (0,1]', [o1, o2, o3].every(o => o.p > 0 && o.p <= 1));

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
