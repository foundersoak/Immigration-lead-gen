#!/usr/bin/env node
/* ============================================================
   VisaClock - batch importer for entity items.
   Validates a research batch, auto-slugs, de-dupes by slug,
   merges into data/items.json, and rebuilds.
   Usage:  node scripts/add-items.js path/to/batch.json
   batch.json = JSON array of item objects matching the items.json schema:
     { name, group, kind ('bulletin'|'explainer'), [category], [country], blurb, ... }
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ITEMS_PATH = path.join(ROOT, 'data', 'items.json');
const BULLETIN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'visa-bulletin.json'), 'utf8'));

const batchPath = process.argv[2];
if (!batchPath) { console.error('Usage: node scripts/add-items.js path/to/batch.json'); process.exit(1); }

const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const data = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
const existing = new Set(data.items.map(i => i.slug));
const batch = JSON.parse(fs.readFileSync(path.resolve(batchPath), 'utf8'));
if (!Array.isArray(batch)) { console.error('Batch must be a JSON array.'); process.exit(1); }

let added = 0, skipped = 0;
const errors = [];
batch.forEach((raw, idx) => {
  const it = Object.assign({}, raw);
  if (!it.name) { errors.push(`#${idx}: missing "name"`); return; }
  it.slug = it.slug ? slugify(it.slug) : slugify(it.name);
  it.kind = it.kind || 'explainer';
  it.group = it.group || (it.kind === 'bulletin' ? 'employment-based' : 'work-visas');
  if (!data.groups[it.group]) { errors.push(`#${idx} (${it.name}): unknown group "${it.group}"`); return; }
  if (it.kind === 'bulletin') {
    if (!it.category || !it.country) { errors.push(`#${idx} (${it.name}): bulletin items need "category" and "country"`); return; }
    if (BULLETIN.categories.indexOf(it.category) === -1) { errors.push(`#${idx} (${it.name}): category "${it.category}" not in visa-bulletin.json`); return; }
    if (BULLETIN.countries.indexOf(it.country) === -1) { errors.push(`#${idx} (${it.name}): country "${it.country}" not in visa-bulletin.json`); return; }
  }
  if (!it.blurb) it.blurb = it.name + '.';
  if (it.reported == null) it.reported = it.kind === 'bulletin';
  if (existing.has(it.slug)) { skipped++; return; }
  existing.add(it.slug);
  data.items.push(it);
  added++;
});

if (errors.length) { console.error('Validation errors:\n' + errors.map(e => '  - ' + e).join('\n')); process.exit(1); }

data.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(ITEMS_PATH, JSON.stringify(data, null, 2) + '\n');
console.log(`Added ${added}, skipped ${skipped} duplicate(s). Total items: ${data.items.length}.`);

console.log('Rebuilding...');
execSync('node ' + JSON.stringify(path.join(__dirname, 'build.js')), { stdio: 'inherit' });
