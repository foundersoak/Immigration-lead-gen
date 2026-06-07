#!/usr/bin/env node
/* ============================================================
   VisaClock - monthly Visa Bulletin refresher
   Fetches the next unpublished month(s) of Employment-Based
   Final Action Dates from travel.state.gov and APPENDS them to
   data/visa-bulletin.json.

   Design principles (this is YMYL data):
     - APPEND-ONLY: never overwrites an existing month.
     - STRICTLY VALIDATED: the table must have the exact expected
       shape (EB-1/2/3 x 5 known countries) and every cell must be
       'C', 'U', or a sane date; month-over-month jumps > 5 years
       are treated as a parse error.
     - FAIL-SAFE: if anything looks off, it makes NO change and
       exits 0 (stale data beats wrong data).

   Usage:
     node scripts/fetch-bulletin.js            # fetch all pending months
     node scripts/fetch-bulletin.js 2026-07    # fetch one specific month
     node scripts/fetch-bulletin.js --selftest # parser self-test (no network)
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_PATH = path.join(__dirname, '..', 'data', 'visa-bulletin.json');
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_ABBR = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const CAT_ROW = { '1ST': 'EB1', '2ND': 'EB2', '3RD': 'EB3' };
const COUNTRY_MATCH = [
  ['AllOther', function (h) { return /EXCEPT|ALL\s*CHARGEABILITY/i.test(h); }],
  ['China', function (h) { return /CHINA/i.test(h); }],
  ['India', function (h) { return /INDIA/i.test(h); }],
  ['Mexico', function (h) { return /MEXICO/i.test(h); }],
  ['Philippines', function (h) { return /PHILIPPIN/i.test(h); }]
];

const stripTags = s => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

/* Convert a bulletin cell ('01SEP13' | 'C' | 'U') to our format. Returns null if unrecognized. */
function cellToDate(raw) {
  const t = stripTags(raw).toUpperCase().replace(/\s+/g, '');
  if (t === 'C') return 'C';
  if (t === 'U') return 'U';
  const m = t.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const mm = MON_ABBR[m[2]];
  if (!mm) return null;
  return '20' + m[3] + '-' + mm + '-' + m[1];
}

/* Parse the EMPLOYMENT-BASED Final Action Dates table out of bulletin HTML.
   Returns { EB1:{country:val}, EB2:{...}, EB3:{...} } or throws on any anomaly. */
function parseEmploymentFinalAction(html) {
  const h = html.replace(/\r?\n/g, ' ');
  // Scan every table; an "employment" table has an INDIA/PHILIPPINES header and a "1st" row
  // (family tables use F1/F2A). Among those, the Final Action one is preceded by the
  // "FINAL ACTION DATES FOR EMPLOYMENT" heading rather than "DATES FOR FILING". We strip
  // tags from the preceding context so interleaved markup in the heading doesn't matter.
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const candidates = [];
  let m;
  while ((m = tableRe.exec(h)) !== null) {
    const rows = (m[0].match(/<tr[\s\S]*?<\/tr>/gi) || []).map(r => (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(stripTags));
    const headerRow = rows.find(cells => cells.some(c => /INDIA/i.test(c)) && cells.some(c => /PHILIPPIN/i.test(c)));
    const hasEmpRow = rows.some(cells => cells.length && /^1ST$/.test(cells[0].toUpperCase().replace(/[^0-9A-Z]/g, '')));
    if (!headerRow || !hasEmpRow) continue;
    const ctx = stripTags(h.slice(Math.max(0, m.index - 2000), m.index)).toUpperCase();
    const posFA = ctx.lastIndexOf('FINAL ACTION DATES FOR EMPLOYMENT');
    const posDF = ctx.lastIndexOf('DATES FOR FILING');
    candidates.push({ rows, headerRow, isFinalAction: posFA !== -1 && posFA > posDF });
  }
  if (!candidates.length) throw new Error('no employment-structured Final Action table found');
  const chosen = candidates.find(c => c.isFinalAction) || candidates[0]; // else first employment table (Final Action comes first)

  const colOf = {};
  COUNTRY_MATCH.forEach(([key, test]) => {
    const idx = chosen.headerRow.findIndex(test);
    if (idx === -1) throw new Error('country column not found: ' + key);
    colOf[key] = idx;
  });

  const out = {};
  chosen.rows.forEach(cells => {
    if (!cells.length) return;
    const label = cells[0].toUpperCase().replace(/[^0-9A-Z]/g, '');
    const cat = CAT_ROW[label];
    if (!cat || out[cat]) return; // first matching row only
    const rec = {};
    COUNTRY_MATCH.forEach(([key]) => {
      const v = cellToDate(cells[colOf[key]] || '');
      if (v == null) throw new Error('unparseable cell for ' + cat + '/' + key + ': "' + (cells[colOf[key]] || '') + '"');
      rec[key] = v;
    });
    out[cat] = rec;
  });

  ['EB1', 'EB2', 'EB3'].forEach(c => { if (!out[c]) throw new Error('missing row: ' + c); });
  return out;
}

/* ---- validation against the existing series (sanity, fail-safe) ---- */
function daysBetween(a, b) { return Math.abs((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8))) / 86400000); }
function validateAgainstPrev(data, cat, country, newVal, bulletinMonth) {
  if (newVal === 'C' || newVal === 'U') return; // status transitions allowed
  const y = +newVal.slice(0, 4);
  if (y < 2000 || y > (+bulletinMonth.slice(0, 4) + 6)) throw new Error('date out of sane range for ' + cat + '/' + country + ': ' + newVal);
  const series = data.finalActionDates[cat][country] || [];
  const prev = series.length ? series[series.length - 1] : null;
  if (prev && prev.date !== 'C' && prev.date !== 'U' && daysBetween(newVal, prev.date) > 1830) {
    throw new Error('implausible >5yr jump for ' + cat + '/' + country + ': ' + prev.date + ' -> ' + newVal + ' (likely a parse error)');
  }
}

/* ---- compact serializer: one line per country series (small monthly diffs) ---- */
function serializeBulletin(data) {
  let out = '{\n';
  const top = ['_note', '_verifiedIndia', 'updated', 'categories', 'countries', 'countryLabels'];
  top.forEach(k => { if (data[k] !== undefined) out += '  ' + JSON.stringify(k) + ': ' + JSON.stringify(data[k]) + ',\n'; });
  out += '  "finalActionDates": {\n';
  data.categories.forEach((cat, ci) => {
    out += '    ' + JSON.stringify(cat) + ': {\n';
    data.countries.forEach((co, coi) => {
      out += '      ' + JSON.stringify(co) + ': ' + JSON.stringify(data.finalActionDates[cat][co]) + (coi < data.countries.length - 1 ? ',' : '') + '\n';
    });
    out += '    }' + (ci < data.categories.length - 1 ? ',' : '') + '\n';
  });
  out += '  }\n}\n';
  return out;
}

/* ---- networking ---- */
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (VisaClock bulletin refresher)' } }, res => {
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function nextMonth(ym) { let [y, m] = ym.split('-').map(Number); m += 1; if (m > 12) { m = 1; y += 1; } return y + '-' + String(m).padStart(2, '0'); }
function bulletinUrl(ym) {
  const [y, m] = ym.split('-').map(Number);
  const fy = m >= 10 ? y + 1 : y; // fiscal-year folder
  return 'https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/' + fy + '/visa-bulletin-for-' + MONTH_NAMES[m - 1] + '-' + y + '.html';
}

/* ---- apply one validated month ---- */
function applyMonth(data, ym, parsed) {
  data.categories.forEach(cat => data.countries.forEach(country => {
    validateAgainstPrev(data, cat, country, parsed[cat][country], ym);
  }));
  // all valid -> append
  data.categories.forEach(cat => data.countries.forEach(country => {
    const series = data.finalActionDates[cat][country];
    if (!series.some(e => e.bulletin === ym)) series.push({ bulletin: ym, date: parsed[cat][country] });
  }));
  data.updated = ym;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) return selftest();
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const latest = (data.finalActionDates.EB2.India || []).map(e => e.bulletin).sort().pop();
  let targets;
  const explicit = args.find(a => /^\d{4}-\d{2}$/.test(a));
  if (explicit) targets = [explicit];
  else { targets = []; let m = nextMonth(latest); for (let i = 0; i < 6; i++) { targets.push(m); m = nextMonth(m); } }

  let added = 0;
  for (const ym of targets) {
    const url = bulletinUrl(ym);
    let html;
    try { html = await fetchHtml(url); } catch (e) { console.log('fetch error for ' + ym + ': ' + e.message + ' (stopping)'); break; }
    if (!html) { console.log(ym + ': not published yet (' + url + ')'); break; }
    let parsed;
    try { parsed = parseEmploymentFinalAction(html); } catch (e) { console.log(ym + ': PARSE FAILED, no change. ' + e.message); break; }
    try { applyMonth(data, ym, parsed); } catch (e) { console.log(ym + ': VALIDATION FAILED, no change. ' + e.message); break; }
    console.log(ym + ': added (EB-2 India = ' + parsed.EB2.India + ', EB-3 India = ' + parsed.EB3.India + ')');
    added++;
  }

  if (added && !args.includes('--dry-run')) {
    fs.writeFileSync(DATA_PATH, serializeBulletin(data));
    console.log('Wrote ' + DATA_PATH + ' (' + added + ' new month(s)). Run `node scripts/build.js` to regenerate.');
  } else if (!added) {
    console.log('No new bulletin to add.');
  }
}

/* ---- parser self-test (no network) ---- */
function selftest() {
  const sample = `
    <h3>A.  FINAL ACTION DATES FOR EMPLOYMENT-BASED PREFERENCE CASES</h3>
    <table border="1"><tbody>
    <tr><td>Employment-based</td><td>All Chargeability Areas Except Those Listed</td><td>CHINA-mainland born</td><td>INDIA</td><td>MEXICO</td><td>PHILIPPINES</td></tr>
    <tr><td>1st</td><td>C</td><td>01JAN23</td><td>15FEB22</td><td>C</td><td>C</td></tr>
    <tr><td>2nd</td><td>C</td><td>01SEP21</td><td>01SEP13</td><td>C</td><td>C</td></tr>
    <tr><td>3rd</td><td>01JUN24</td><td>01AUG21</td><td>15DEC13</td><td>01JUN24</td><td>08FEB23</td></tr>
    <tr><td>Other Workers</td><td>01JUN24</td><td>01JAN17</td><td>15DEC13</td><td>01JUN24</td><td>08FEB23</td></tr>
    </tbody></table>`;
  const r = parseEmploymentFinalAction(sample);
  const expect = { EB1India: '2022-02-15', EB2India: '2013-09-01', EB3India: '2013-12-15', EB2China: '2021-09-01', EB1All: 'C', EB3All: '2024-06-01' };
  const got = { EB1India: r.EB1.India, EB2India: r.EB2.India, EB3India: r.EB3.India, EB2China: r.EB2.China, EB1All: r.EB1.AllOther, EB3All: r.EB3.AllOther };
  let ok = true;
  Object.keys(expect).forEach(k => { const pass = expect[k] === got[k]; if (!pass) ok = false; console.log((pass ? '  ok   ' : '  FAIL ') + k + ' = ' + got[k] + (pass ? '' : ' (expected ' + expect[k] + ')')); });
  console.log(ok ? '\nParser self-test passed.' : '\nParser self-test FAILED.');
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
module.exports = { parseEmploymentFinalAction, cellToDate, serializeBulletin };
