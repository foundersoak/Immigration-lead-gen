#!/usr/bin/env node
/* Integrate verified guides from a workflow output JSON into guides-content.js.
   Decodes HTML entities in bodies, de-dupes by slug, and rewrites the module.
   Usage: node scripts/integrate-guides.js <workflow-output.json> */
'use strict';
const fs = require('fs');
const path = require('path');
const BT = String.fromCharCode(96); // backtick

const outPath = process.argv[2];
if (!outPath) { console.error('usage: node scripts/integrate-guides.js <workflow-output.json>'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const guides = (raw.result && raw.result.guides) || raw.guides;
if (!Array.isArray(guides)) { console.error('no guides array found'); process.exit(1); }

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const prepared = guides.map(g => {
  const encoded = /&lt;|&gt;/.test(g.body);
  const body = encoded ? decode(g.body) : g.body;
  return { slug: g.slug, title: g.title, desc: g.desc, date: '2026-06-07', body, _verdict: g.verdict, _issues: g.issues || [] };
});

console.log('--- fact-check report ---');
prepared.forEach(g => {
  console.log(g.slug + ': ' + g._verdict +
    ' | issues=' + g._issues.length +
    ' | len=' + g.body.length +
    ' | backtick=' + (g.body.indexOf(BT) !== -1) +
    ' | strayEntity=' + (/&lt;|&gt;|&amp;lt;/.test(g.body)) +
    ' | disclaimer=' + (/not legal, financial, or tax advice/.test(g.body)) +
    ' | cta=' + (g.body.indexOf('cta-inline') !== -1));
  g._issues.forEach(i => console.log('     - ' + i));
});

const gcPath = path.join(__dirname, 'guides-content.js');
const existing = require('./guides-content.js');
const newSlugs = new Set(prepared.map(g => g.slug));
const kept = existing.filter(e => !newSlugs.has(e.slug));
const combined = kept.concat(prepared.map(g => ({ slug: g.slug, title: g.title, desc: g.desc, date: g.date, body: g.body })));

const header = '/* ============================================================\n' +
  '   GreenCardETA - guide articles (un-gated SEO content)\n' +
  '   Each guide: { slug, title, desc, date, body }  (body = HTML)\n' +
  '   In-body links use ../../ because guides render at /guide/<slug>/.\n' +
  '   ============================================================ */\n' +
  "'use strict';\n\nmodule.exports = [\n";
fs.writeFileSync(gcPath, header + combined.map(g => JSON.stringify(g, null, 2)).join(',\n') + '\n];\n');
console.log('\nWrote guides-content.js: ' + combined.length + ' guides total (' + prepared.length + ' new, ' + kept.length + ' kept).');
