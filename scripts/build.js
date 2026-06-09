#!/usr/bin/env node
/* ============================================================
   GreenCardETA - static page generator
   Reads:
     data/items.json          (visa-category entity pages + work-visa explainers)
     data/visa-bulletin.json  (DOS Final Action Dates history)
     scripts/guides-content.js (guide articles)
   Generates:
     /visa/<slug>/index.html   (one per category/country or explainer)
     /visa/index.html          (directory)
     /guide/<slug>/index.html  (guide articles)
     /guides/index.html        (guides index)
     /assets/data/bulletin-index.json  (client data for the calculator)
     /assets/data/items-index.json     (client search index)
     sitemap.xml
   And stamps asset version + analytics into the hand-written
   static pages (index.html, privacy.html, terms.html).
   Run:  node scripts/build.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'items.json'), 'utf8'));
const BULLETIN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'visa-bulletin.json'), 'utf8'));
const GUIDES = require('./guides-content.js');

/* ---- Config ---- */
const SITE_URL = 'https://greencardeta.com';      // no trailing slash; set to your domain
const BRAND = 'GreenCardETA';                       // placeholder brand; swap once you pick a name
const BRAND_TAGLINE = 'Know your green card timeline.';
const ADSENSE_CLIENT = 'ca-pub-6381950276439830'; // your AdSense publisher id
const FORMSPREE = 'https://formspree.io/f/xojzegbv'; // your lead/email endpoint
const GA4_ID = 'G-V7X4B4EYCT';                    // Google Analytics 4 Measurement ID ('' to disable)
const GSC_VERIFICATION = '';                      // Search Console HTML-tag token ('' to disable)
const UPDATED = DATA.updated || BULLETIN.updated || '2026-06-07';

/* Asset version: hash of CSS+JS so browsers re-fetch when either changes. */
const ASSET_VER = (() => {
  try {
    const css = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'styles.css'));
    const js = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'calculator.js'));
    return crypto.createHash('md5').update(css).update(js).digest('hex').slice(0, 8);
  } catch (e) { return 'dev'; }
})();

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function fmtBulletinMonth(ym) { // '2026-06' -> 'June 2026'
  const [y, m] = String(ym).split('-').map(Number);
  return (MONTHS[m - 1] || '') + ' ' + y;
}
function parseISO(d) { const [y, m, day] = String(d).split('-').map(Number); return new Date(Date.UTC(y, m - 1, day || 1)); }
function fmtDate(d) { // 'C' | 'U' | '2013-09-01' -> human
  if (d === 'C') return 'Current';
  if (d === 'U') return 'Unavailable';
  const dt = parseISO(d);
  return MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate() + ', ' + dt.getUTCFullYear();
}

/* ---- bulletin math (server-side, for the public SEO text on each page) ---- */
function series(category, country) {
  return ((BULLETIN.finalActionDates[category] || {})[country] || []).slice();
}
function bulletinPublic(category, country) {
  const s = series(category, country);
  if (!s.length) return null;
  const latest = s[s.length - 1];
  const prev = s.length > 1 ? s[s.length - 2] : null;
  let deltaDays = null, direction = 'no change';
  if (prev && latest.date !== 'C' && latest.date !== 'U' && prev.date !== 'C' && prev.date !== 'U') {
    deltaDays = Math.round((parseISO(latest.date) - parseISO(prev.date)) / 86400000);
    direction = deltaDays > 5 ? 'advanced' : (deltaDays < -5 ? 'retrogressed' : 'held steady');
  } else if (prev && latest.date === 'C' && prev.date !== 'C') {
    direction = 'became current';
  }
  // net pace across the available window (days of advance per month), retrogression included
  const real = s.filter(e => e.date !== 'C' && e.date !== 'U');
  let paceDays = null;
  if (real.length >= 2) {
    const first = real[0], last = real[real.length - 1];
    const spanMonths = monthsApart(first.bulletin, last.bulletin);
    if (spanMonths > 0) paceDays = Math.round((parseISO(last.date) - parseISO(first.date)) / 86400000 / spanMonths);
  }
  return { latestMonth: latest.bulletin, latestDate: latest.date, prevDate: prev ? prev.date : null, deltaDays, direction, paceDays, isCurrent: latest.date === 'C' };
}
function monthsApart(a, b) { // '2025-07','2026-06'
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/* ---------- analytics / verification markup ---------- */
function analyticsSnippet() {
  let out = '';
  if (GSC_VERIFICATION) out += `<meta name="google-site-verification" content="${GSC_VERIFICATION}" />`;
  if (GA4_ID && GA4_ID.indexOf('XXXX') === -1) out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4_ID}');</script>`;
  return out;
}

/* ---------- shared HTML chunks ---------- */
function head(opts) {
  const { title, desc, canonical, prefix, jsonld } = opts;
  const adsense = ADSENSE_CLIENT.indexOf('XXXX') === -1
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${analyticsSnippet()}
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="theme-color" content="#0b2545" />
  <meta name="vc-base" content="${prefix}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${canonical}" />
  <meta name="twitter:card" content="summary_large_image" />
  ${adsense}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${prefix}assets/css/styles.css?v=${ASSET_VER}" />
  ${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="${prefix}index.html">
        <span class="brand-mark" aria-hidden="true">◷</span>
        <span class="brand-text">${esc(BRAND)}</span>
      </a>
      <nav class="nav-links">
        <a href="${prefix}index.html">Green card wait</a>
        <a href="${prefix}h1b-odds/index.html">H-1B odds</a>
        <a href="${prefix}visa/index.html">Visa categories</a>
        <a href="${prefix}guides/index.html">Guides</a>
        <a class="nav-cta" href="${prefix}index.html#calculator">Estimate my wait</a>
      </nav>
    </div>
  </header>
  <main>`;
}

function adUnit() {
  // Rely on Auto ads (Google auto-places once approved). Manual <ins> units need real slot IDs,
  // so we render nothing here for now to avoid empty "Advertisement" boxes. Wire real slots later.
  return '';
}

function foot(prefix) {
  return `</main>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <a class="brand" href="${prefix}index.html"><span class="brand-mark" aria-hidden="true">◷</span><span class="brand-text">${esc(BRAND)}</span></a>
        <p class="footer-tag">${esc(BRAND_TAGLINE)}</p>
      </div>
      <nav class="footer-links">
        <a href="${prefix}index.html">Green card wait</a>
        <a href="${prefix}h1b-odds/index.html">H-1B odds</a>
        <a href="${prefix}visa/index.html">Visa categories</a>
        <a href="${prefix}guides/index.html">Guides</a>
        <a href="${prefix}contact.html">Contact</a>
        <a href="${prefix}privacy.html">Privacy</a>
        <a href="${prefix}terms.html">Terms</a>
      </nav>
    </div>
    <div class="container footer-bottom">
      <p>© ${new Date().getFullYear()} ${esc(BRAND)}. Estimates are informational only, based on published USCIS and U.S. Department of State data and historical trends. This is not legal, financial, or tax advice, and no attorney-client relationship is created. Wait-time projections are not guarantees; priority dates can move backward (retrogression). Not affiliated with USCIS, the Department of State, or any government agency. We may share inquiries you submit with one or more partner immigration law firms who may contact you by email. Data updated ${esc(UPDATED)}.</p>
    </div>
  </footer>
  <script src="${prefix}assets/js/calculator.js?v=${ASSET_VER}" defer></script>
</body>
</html>`;
}

/* ---- the green-card wait tool widget (reused on entity pages; mirrored by hand in index.html) ---- */
function waitTool(opts) {
  const { category, country, locked } = opts;
  const catOpts = BULLETIN.categories.map(c => `<option value="${c}"${c === category ? ' selected' : ''}>${c.replace('EB', 'EB-')}</option>`).join('');
  const countryOpts = BULLETIN.countries.map(c => `<option value="${c}"${c === country ? ' selected' : ''}>${esc(BULLETIN.countryLabels[c] || c)}</option>`).join('');
  const selectors = locked ? '' : `
      <label class="gc-field">Category
        <select class="gc-in-category">${catOpts}</select>
      </label>
      <label class="gc-field">Country of birth
        <select class="gc-in-country">${countryOpts}</select>
      </label>`;
  return `<div class="gc-tool" data-tool="wait" data-category="${esc(category || 'EB2')}" data-country="${esc(country || 'India')}" data-locked="${locked ? 'true' : 'false'}">
    <form class="gc-form">
      ${selectors}
      <div class="gc-field">
        <span class="gc-pd-label">Your priority date</span>
        <div class="gc-pd-row">
          <select class="gc-in-pd-month" required aria-label="Priority date month"><option value="" disabled selected>Month</option></select>
          <select class="gc-in-pd-year" required aria-label="Priority date year"><option value="" disabled selected>Year</option></select>
        </div>
      </div>
      <button type="submit" class="btn btn-primary gc-submit">Estimate my wait</button>
    </form>
    <div class="gc-out" hidden>
      <div class="gc-public"></div>
      <form class="gc-gate email-form" action="${FORMSPREE}" method="POST" hidden>
        <p class="gate-pitch">🔒 Your estimate is ready. Enter your details to see your <strong>projected date</strong> (best / likely / worst case) and the trend behind it. Free.</p>
        <input type="hidden" name="_subject" value="${BRAND} lead" class="gc-f-subject" />
        <input type="hidden" name="tool" value="Green Card Wait Estimator" />
        <input type="hidden" name="category" value="" class="gc-f-category" />
        <input type="hidden" name="country" value="" class="gc-f-country" />
        <input type="hidden" name="priority_date" value="" class="gc-f-pd" />
        <input type="hidden" name="estimate" value="" class="gc-f-estimate" />
        <input type="hidden" name="source_page" value="" class="gc-f-page" />
        <input type="text" name="name" required placeholder="Your name" aria-label="Your name" />
        <input type="email" name="email" required placeholder="you@email.com" aria-label="Email address" />
        <input type="tel" name="phone" placeholder="Phone (optional)" aria-label="Phone (optional)" class="gc-optional" />
        <label class="gc-consent"><input type="checkbox" name="consent" required /> <span>I agree that ${esc(BRAND)} may share my inquiry with one or more partner immigration law firms, who may contact me by email about my case. I can unsubscribe anytime.</span></label>
        <button type="submit" class="btn btn-primary">Unlock my projected date</button>
        <p class="privacy-note">No spam. <a href="REPLACE_PREFIXprivacy.html">Privacy</a>.</p>
      </form>
      <div class="gc-reveal" hidden></div>
    </div>
  </div>`;
}

/* ---- a standalone "talk to an attorney" lead form for explainer pages ---- */
function leadForm(prefix, context) {
  return `<section class="container narrow">
    <div class="lead-card">
      <h3>Talk to an immigration attorney about ${esc(context)}</h3>
      <p>Tell us a bit about your situation and we'll connect you with a partner immigration law firm for a consultation.</p>
      <form class="email-form lead-standalone" action="${FORMSPREE}" method="POST">
        <input type="hidden" name="_subject" value="${BRAND} lead: ${esc(context)}" />
        <input type="hidden" name="topic" value="${esc(context)}" />
        <input type="hidden" name="source_page" value="${esc(context)}" />
        <input type="text" name="name" required placeholder="Your name" aria-label="Your name" />
        <input type="email" name="email" required placeholder="you@email.com" aria-label="Email address" />
        <input type="tel" name="phone" placeholder="Phone (optional)" aria-label="Phone (optional)" />
        <input type="text" name="country_of_birth" required placeholder="Country of birth" aria-label="Country of birth" />
        <label class="gc-consent"><input type="checkbox" name="consent" required /> <span>I agree that ${esc(BRAND)} may share my inquiry with one or more partner immigration law firms, who may contact me by email about my case. I can unsubscribe anytime.</span></label>
        <button type="submit" class="btn btn-primary">Request a consultation</button>
        <p class="privacy-note">Informational service, not a law firm. <a href="${prefix}privacy.html">Privacy</a> · <a href="${prefix}terms.html">Terms</a>.</p>
      </form>
    </div>
  </section>`;
}

/* ---------- related-category links (interlinking) ---------- */
function relatedLinks(item) {
  const sameCountry = DATA.items.filter(i => i.kind === 'bulletin' && i.country === item.country && i.slug !== item.slug);
  const sameCat = DATA.items.filter(i => i.kind === 'bulletin' && i.category === item.category && i.country !== item.country);
  const links = sameCountry.concat(sameCat).slice(0, 6);
  if (!links.length) return '';
  return `<section class="container narrow">
      <h2>Related categories</h2>
      <div class="related-links">${links.map(i => `<a href="../../visa/${i.slug}/index.html">${esc(i.name)}</a>`).join('')}</div>
    </section>`;
}

/* ---------- entity page: bulletin (priority-date) ---------- */
function bulletinPage(item) {
  const prefix = '../../';
  const url = `${SITE_URL}/visa/${item.slug}/`;
  const pub = bulletinPublic(item.category, item.country);
  const catLabel = item.category.replace('EB', 'EB-');
  const countryLabel = BULLETIN.countryLabels[item.country] || item.country;
  const title = `${item.name} Green Card Wait & Priority Date (${pub ? fmtBulletinMonth(pub.latestMonth) : 'Latest'} Visa Bulletin) | ${BRAND}`;
  const desc = `Current ${catLabel} ${countryLabel} Final Action Date and a personalized priority-date wait estimate. See how the cutoff is moving in the latest Visa Bulletin.`;

  let publicText = '';
  if (pub) {
    if (pub.isCurrent) {
      publicText = `<p>As of the <strong>${fmtBulletinMonth(pub.latestMonth)}</strong> Visa Bulletin, <strong>${esc(item.name)}</strong> is <strong>Current</strong> in the Final Action Dates chart, meaning visa numbers are available now for qualifying applicants.</p>`;
    } else {
      const moved = pub.deltaDays != null
        ? ` Compared with the prior month it ${pub.direction} ${pub.direction === 'held steady' ? '' : 'by about ' + Math.abs(Math.round(pub.deltaDays / 30)) + ' month(s)'}.`
        : '';
      const pace = pub.paceDays != null
        ? ` Over the last ${monthsApart(series(item.category, item.country)[0].bulletin, pub.latestMonth)} months it has moved at an average of about ${pub.paceDays} day(s) per month${pub.paceDays <= 0 ? ' (little to no net forward movement)' : ''}.`
        : '';
      publicText = `<p>As of the <strong>${fmtBulletinMonth(pub.latestMonth)}</strong> Visa Bulletin, the <strong>${esc(item.name)}</strong> Final Action Date is <strong>${fmtDate(pub.latestDate)}</strong>.${moved}${pace}</p>`;
    }
  } else {
    publicText = `<p>We are adding the latest Visa Bulletin data for ${esc(item.name)}.</p>`;
  }

  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Visa categories", "item": `${SITE_URL}/visa/` },
        { "@type": "ListItem", "position": 2, "name": item.name, "item": url }
      ]},
      { "@type": "FAQPage", "mainEntity": [
        { "@type": "Question", "name": `What is the current ${item.name} Final Action Date?`,
          "acceptedAnswer": { "@type": "Answer", "text": pub ? `As of the ${fmtBulletinMonth(pub.latestMonth)} Visa Bulletin, the ${item.name} Final Action Date is ${fmtDate(pub.latestDate)}. Priority dates can move backward, so check each month.` : `See the latest Visa Bulletin for ${item.name}.` } },
        { "@type": "Question", "name": `How long is the ${item.name} green card wait?`,
          "acceptedAnswer": { "@type": "Answer", "text": `It depends on your priority date and how fast the cutoff moves. Enter your priority date in the estimator to see a personalized best, likely and worst-case projection. Estimates are informational only and not guarantees.` } }
      ]}
    ]
  };

  return head({ title, desc, canonical: url, prefix, jsonld }) + `
    <section class="container narrow entity-hero">
      <nav class="crumbs"><a href="${prefix}visa/index.html">Visa categories</a> › <span>${esc(item.name)}</span></nav>
      <h1>${esc(item.name)} green card wait &amp; priority date</h1>
      <p class="entity-sub">${esc(item.blurb || '')}</p>
      ${publicText}
    </section>
    <section class="container narrow">
      <h2>Estimate your wait</h2>
      <p class="muted">Enter your priority date for ${esc(catLabel)} ${esc(countryLabel)}. We project when your date may become current based on how the cutoff has moved recently. Projections are estimates, not guarantees, and dates can retrogress.</p>
      ${waitTool({ category: item.category, country: item.country, locked: true }).replace(/REPLACE_PREFIX/g, prefix)}
    </section>
    ${adUnit()}
    <section class="container narrow">
      <h2>How we estimate this</h2>
      <p>We take the recent month-over-month movement of the ${esc(item.name)} Final Action Date in the Visa Bulletin and project it forward to your priority date. Because movement is uneven (and sometimes negative), we show a best, likely and worst-case window rather than a single date. ${item.source ? `Source: <a href="${esc(item.sourceUrl)}" rel="nofollow noopener" target="_blank">${esc(item.source)}</a>.` : ''}</p>
      <div class="cta-inline">
        <p><strong>Worried about retrogression or a job change?</strong> These are exactly the moments to talk to an attorney.</p>
        <a class="btn btn-secondary" href="${prefix}guides/index.html">Read the guides</a>
      </div>
    </section>
    ${relatedLinks(item)}
    ${leadForm(prefix, item.name + ' green card')}
  ` + foot(prefix);
}

/* ---------- entity page: explainer ---------- */
function explainerPage(item) {
  const prefix = '../../';
  const url = `${SITE_URL}/visa/${item.slug}/`;
  const title = `${item.name}: Requirements, Timeline & Next Steps | ${BRAND}`;
  const desc = `${item.blurb} Plain-English overview, who it fits, and how to get help.`;
  const jsonld = {
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": [{ "@type": "Question", "name": `What is the ${item.name}?`, "acceptedAnswer": { "@type": "Answer", "text": item.blurb } }]
  };
  return head({ title, desc, canonical: url, prefix, jsonld }) + `
    <section class="container narrow entity-hero">
      <nav class="crumbs"><a href="${prefix}visa/index.html">Visa categories</a> › <span>${esc(item.name)}</span></nav>
      <h1>${esc(item.name)}</h1>
      <p class="entity-sub">${esc(item.blurb || '')}</p>
    </section>
    ${adUnit()}
    <section class="container narrow">
      <h2>Is the green card backlog affecting you?</h2>
      <p>If your path runs through an employment green card, your wait depends on your category and country of birth. Check your priority-date timeline:</p>
      <div class="cta-inline">
        <a class="btn btn-primary" href="${prefix}index.html#wait">Open the green card wait estimator</a>
      </div>
      ${item.source ? `<p class="muted">Official reference: <a href="${esc(item.sourceUrl)}" rel="nofollow noopener" target="_blank">${esc(item.source)}</a>.</p>` : ''}
    </section>
    ${leadForm(prefix, item.name)}
  ` + foot(prefix);
}

/* ---------- directory ---------- */
function directoryPage() {
  const prefix = '../';
  const url = `${SITE_URL}/visa/`;
  const title = `Visa Categories & Priority Dates | ${BRAND}`;
  const desc = `Browse employment green card categories (EB-1, EB-2, EB-3) by country and key U.S. work visas. See current Final Action Dates and estimate your wait.`;
  const groups = DATA.groups || {};
  const byGroup = {};
  DATA.items.forEach(it => { (byGroup[it.group] = byGroup[it.group] || []).push(it); });
  const sections = Object.keys(byGroup).map(gk => {
    const g = groups[gk] || { name: gk };
    const cards = byGroup[gk].map(it => {
      let tag = it.kind === 'bulletin' ? (it.category.replace('EB', 'EB-')) : 'Visa';
      let meta = '';
      if (it.kind === 'bulletin') {
        const pub = bulletinPublic(it.category, it.country);
        meta = pub ? (pub.isCurrent ? 'Current' : fmtDate(pub.latestDate)) : '';
      }
      return `<a class="entity-card" href="${prefix}visa/${it.slug}/index.html">
        <span class="ec-tag">${esc(tag)}</span>
        <strong>${esc(it.name)}</strong>
        <span class="ec-meta">${esc(meta || it.blurb.slice(0, 60))}</span>
        <span class="ec-cta">${it.kind === 'bulletin' ? 'Estimate the wait ›' : 'Learn more ›'}</span>
      </a>`;
    }).join('');
    return `<h2>${esc(g.name)}</h2><p class="muted">${esc(g.blurb || '')}</p><div class="entity-grid">${cards}</div>`;
  }).join('');
  return head({ title, desc, canonical: url, prefix, jsonld: { "@context": "https://schema.org", "@type": "CollectionPage", "name": title, "url": url } }) + `
    <section class="container narrow entity-hero">
      <h1>Visa categories &amp; priority dates</h1>
      <p class="entity-sub">Employment green card categories and key work visas. Pick yours to see the current Final Action Date and estimate your wait.</p>
    </section>
    ${adUnit()}
    <section class="container">${sections}
      <div class="cta-inline" style="margin-top:2rem">
        <a class="btn btn-primary" href="${prefix}index.html#wait">Open the green card wait estimator</a>
      </div>
    </section>
  ` + foot(prefix);
}

/* ---------- guides ---------- */
function guidePage(g) {
  const prefix = '../../';
  const url = `${SITE_URL}/guide/${g.slug}/`;
  const jsonld = {
    "@context": "https://schema.org", "@type": "Article",
    "headline": g.title, "description": g.desc, "datePublished": g.date, "dateModified": g.date,
    "author": { "@type": "Organization", "name": BRAND }, "publisher": { "@type": "Organization", "name": BRAND },
    "mainEntityOfPage": url
  };
  return head({ title: `${g.title} | ${BRAND}`, desc: g.desc, canonical: url, prefix, jsonld }) + `
    <section class="container narrow article">
      <nav class="crumbs"><a href="${prefix}index.html">Home</a> › <a href="${prefix}guides/index.html">Guides</a> › <span>${esc(g.title)}</span></nav>
      <h1>${esc(g.title)}</h1>
      <p class="article-meta">Updated ${esc(g.date)}</p>
      ${g.body}
      <div class="cta-inline">
        <p><strong>Want a number for your own case?</strong> Estimate your green card wait in seconds.</p>
        <a class="btn btn-primary" href="${prefix}index.html#wait">Open the wait estimator</a>
      </div>
    </section>
    ${adUnit()}
    ${leadForm(prefix, g.title)}
  ` + foot(prefix);
}
/* Guide categories. Each guide slug maps to a section; the order of GUIDE_SECTIONS
   sets the on-page order, and the order of slugs within sets card order.
   Any guide not listed here falls into the "More guides" catch-all so new
   articles never silently disappear from the index. */
const GUIDE_SECTIONS = [
  { title: 'Visa Bulletin basics', blurb: 'Read the monthly bulletin and know where you stand.', slugs: [
    'how-to-read-the-visa-bulletin', 'what-is-retrogression', 'dates-for-filing-vs-final-action' ] },
  { title: 'The India &amp; China backlog', blurb: 'Why the wait is so long, and how the per-country caps work.', slugs: [
    'why-india-green-card-wait-so-long', 'china-green-card-backlog', 'cross-chargeability-spouse-country' ] },
  { title: 'Speeding up your case', blurb: 'Categories and strategies that can move you up the line.', slugs: [
    'eb2-vs-eb3-downgrade', 'eb1-for-indians', 'eb2-niw-india-does-it-help', 'eb5-india-china-backlog-workaround' ] },
  { title: 'The H-1B lottery', blurb: 'Your odds, the new rules, and what to do if you are not selected.', slugs: [
    'fy2027-h1b-wage-weighted-lottery', 'h1b-not-selected-options', 'new-100k-h1b-fee' ] },
  { title: 'When life changes', blurb: 'Job changes, layoffs and children aging out.', slugs: [
    'job-change-ac21-portability', 'cspa-aging-out-children' ] },
];
function guidesIndex() {
  const prefix = '../';
  const url = `${SITE_URL}/guides/`;
  const bySlug = new Map(GUIDES.map(g => [g.slug, g]));
  const used = new Set();
  const card = g => `<a class="guide-card" href="${prefix}guide/${g.slug}/index.html"><strong>${esc(g.title)}</strong><span>${esc(g.desc)}</span></a>`;
  const sections = GUIDE_SECTIONS.map(sec => {
    const items = sec.slugs.map(s => bySlug.get(s)).filter(Boolean);
    items.forEach(g => used.add(g.slug));
    if (!items.length) return '';
    return `<section class="container narrow guide-section">
      <h2>${sec.title}</h2>
      <p class="guide-section-sub">${sec.blurb}</p>
      <div class="guide-list">${items.map(card).join('')}</div>
    </section>`;
  }).join('');
  const leftovers = GUIDES.filter(g => !used.has(g.slug));
  const more = leftovers.length ? `<section class="container narrow guide-section">
      <h2>More guides</h2>
      <div class="guide-list">${leftovers.map(card).join('')}</div>
    </section>` : '';
  return head({
    title: `Green Card & Visa Guides | ${BRAND}`,
    desc: `Plain-English guides to the Visa Bulletin, priority dates, retrogression, the H-1B lottery, and your options when things change.`,
    canonical: url, prefix, jsonld: { "@context": "https://schema.org", "@type": "CollectionPage", "name": "Guides", "url": url }
  }) + `
    <section class="container narrow entity-hero">
      <h1>Green card &amp; visa guides</h1>
      <p class="entity-sub">Plain-English explainers on the Visa Bulletin, priority dates and your options.</p>
    </section>
    ${sections}${more}
  ` + foot(prefix);
}

/* ---------- H-1B odds tool widget ---------- */
function oddsTool(prefix) {
  return `<div class="gc-tool" data-tool="odds">
    <form class="h1b-form">
      <label class="gc-field">Your offered wage level
        <select class="h1b-in-wage">
          <option value="1">Level I — entry (~17th percentile)</option>
          <option value="2" selected>Level II — qualified (~34th percentile)</option>
          <option value="3">Level III — experienced (~50th percentile)</option>
          <option value="4">Level IV — fully competent (~67th+ percentile)</option>
        </select>
      </label>
      <p class="gc-help">Your wage level reflects how your offered salary compares to the U.S. Department of Labor prevailing wage for your specific <em>job and work location</em> — not your country.</p>
      <label class="gc-consent gc-degree"><input type="checkbox" class="h1b-in-degree" /> <span>I have a U.S. master's degree or higher (advanced-degree second draw)</span></label>
      <button type="submit" class="btn btn-primary">Estimate my odds</button>
    </form>
    <div class="h1b-out" hidden>
      <form class="gc-gate h1b-gate email-form" action="${FORMSPREE}" method="POST" hidden>
        <p class="gate-pitch">🔒 Your odds are ready. Enter your details to see your <strong>estimated selection chance</strong> and your best backup options. Free.</p>
        <input type="hidden" name="tool" value="H-1B Odds Calculator" />
        <input type="hidden" name="_subject" value="${esc(BRAND)} lead" class="h1b-f-subject" />
        <input type="hidden" name="wage_level" value="" class="h1b-f-wage" />
        <input type="hidden" name="advanced_degree" value="" class="h1b-f-degree" />
        <input type="hidden" name="estimate" value="" class="h1b-f-estimate" />
        <input type="hidden" name="source_page" value="" class="gc-f-page" />
        <input type="text" name="name" required placeholder="Your name" aria-label="Your name" />
        <input type="email" name="email" required placeholder="you@email.com" aria-label="Email address" />
        <input type="tel" name="phone" placeholder="Phone (optional)" aria-label="Phone (optional)" class="gc-optional" />
        <input type="text" name="country_of_birth" required placeholder="Country of birth" aria-label="Country of birth" />
        <label class="gc-consent"><input type="checkbox" name="consent" required /> <span>I agree that ${esc(BRAND)} may share my inquiry with one or more partner immigration law firms, who may contact me by email about my case. I can unsubscribe anytime.</span></label>
        <button type="submit" class="btn btn-primary">Show my odds</button>
        <p class="privacy-note">No spam. <a href="${prefix}privacy.html">Privacy</a>.</p>
      </form>
      <div class="h1b-reveal" hidden></div>
    </div>
  </div>`;
}

/* ---------- dedicated H-1B odds page ---------- */
function h1bOddsPage() {
  const prefix = '../';
  const url = `${SITE_URL}/h1b-odds/`;
  const title = `H-1B Lottery Odds Calculator (FY2027 Wage-Weighted) | ${BRAND}`;
  const desc = `Estimate your H-1B selection odds under the new FY2027 wage-weighted lottery, by wage level and advanced-degree status. Free.`;
  const jsonld = { "@context": "https://schema.org", "@type": "WebApplication", "name": "H-1B Odds Calculator", "applicationCategory": "BusinessApplication", "operatingSystem": "Web", "offers": { "@type": "Offer", "price": "0" }, "description": desc };
  return head({ title, desc, canonical: url, prefix, jsonld }) + `
    <section class="hero">
      <div class="container narrow">
        <h1>What are your H-1B lottery odds?</h1>
        <p class="hero-sub">The FY2027 H-1B lottery is no longer a flat coin flip — it weights selection by wage level. Estimate your chance by wage level and degree. Free.</p>
        <a class="btn btn-primary btn-lg" href="#calculator">Estimate my odds ↓</a>
        <p class="hero-trust">Modeled estimate · Informational, not legal advice</p>
        <p class="hero-alt">Already past the lottery? <a href="${prefix}index.html">Track your green card timeline →</a></p>
      </div>
    </section>
    <section class="container calc-wrap" id="calculator">
      <div class="calc-panel">
        <h2>H-1B selection odds (FY2027 wage-weighted lottery)</h2>
        <p class="muted">The FY2027 lottery gives higher wage levels more entries (Level IV is weighted highest). This is a modeled estimate, not a guarantee.</p>
        ${oddsTool(prefix)}
      </div>
    </section>
    <section class="container narrow info-block">
      <h2>How the wage-weighted lottery works</h2>
      <ol class="how-steps">
        <li><strong>Your wage level sets your entries.</strong> Each registration gets entries based on how your offered salary compares to the local prevailing wage: Level IV = 4 entries, Level III = 3, Level II = 2, Level I = 1. More entries means a higher chance.</li>
        <li><strong>An advanced U.S. degree adds a second draw.</strong> If you hold a U.S. master's degree or higher, you're entered in both the regular cap and the 20,000-spot advanced-degree cap, improving your odds.</li>
        <li><strong>We model your chance.</strong> Selection percentages by wage level are estimates based on the published rule and recent pool sizes; USCIS does not publish exact odds in advance.</li>
      </ol>
    </section>
    <section class="container narrow info-block" id="terms">
      <h2>Key terms, in plain English</h2>
      <div class="defs-grid">
        <div class="def-card"><h3>Wage Level (I–IV)</h3><p>How your offered salary compares to the U.S. prevailing wage for your specific job and work location (set by the Department of Labor) — <strong>not your country</strong>. Level I ≈ entry (~17th percentile), II ≈ qualified (~34th), III ≈ experienced (~50th), IV ≈ fully competent (~67th and up).</p></div>
        <div class="def-card"><h3>The H-1B cap</h3><p>The annual limit on new cap-subject H-1Bs: 65,000 regular plus 20,000 reserved for U.S. advanced-degree holders.</p></div>
        <div class="def-card"><h3>Master's cap (second draw)</h3><p>A U.S. master's degree or higher gets you a second chance in the advanced-degree lottery, on top of the regular draw.</p></div>
        <div class="def-card"><h3>Registration</h3><p>The short March window when your employer registers you for the lottery (FY2027 ran March 4–19, 2026).</p></div>
        <div class="def-card"><h3>Prevailing wage</h3><p>The typical pay for your job and location, set by Department of Labor data. Your wage level is measured against it.</p></div>
        <div class="def-card"><h3>Cap-exempt</h3><p>Universities and nonprofit research employers can sponsor H-1Bs any time, outside the lottery entirely.</p></div>
      </div>
      <p class="muted">Not selected? Read <a href="${prefix}guide/h1b-not-selected-options/index.html">your options after the H-1B lottery</a>.</p>
    </section>
    ${leadForm(prefix, 'H-1B options')}
  ` + foot(prefix);
}

/* ---------- write helpers ---------- */
function writeFile(rel, html) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
  console.log('  wrote', rel);
}

/* ---------- run ---------- */
const items = DATA.items || [];
console.log(`Generating from ${items.length} items, ${GUIDES.length} guides...`);

items.forEach(it => {
  const html = it.kind === 'bulletin' ? bulletinPage(it) : explainerPage(it);
  writeFile(path.join('visa', it.slug, 'index.html'), html);
});
writeFile(path.join('visa', 'index.html'), directoryPage());
GUIDES.forEach(g => writeFile(path.join('guide', g.slug, 'index.html'), guidePage(g)));
writeFile(path.join('guides', 'index.html'), guidesIndex());
writeFile(path.join('h1b-odds', 'index.html'), h1bOddsPage());

/* client data: the bulletin series (for the calculator) */
writeFile(path.join('assets', 'data', 'bulletin-index.json'), JSON.stringify({
  updated: BULLETIN.updated, categories: BULLETIN.categories, countries: BULLETIN.countries,
  countryLabels: BULLETIN.countryLabels, finalActionDates: BULLETIN.finalActionDates
}));

/* client search index */
const searchIndex = items.map(it => ({ slug: it.slug, name: it.name, group: it.group, kind: it.kind, category: it.category || '', country: it.country || '' }));
writeFile(path.join('assets', 'data', 'items-index.json'), JSON.stringify(searchIndex));

/* stamp asset version + analytics into the hand-written static pages */
['index.html', 'privacy.html', 'terms.html', 'contact.html'].forEach(f => {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) return;
  const out = fs.readFileSync(fp, 'utf8')
    .replace(/(assets\/css\/styles\.css|assets\/js\/calculator\.js)(\?v=[a-z0-9]+)?/g, `$1?v=${ASSET_VER}`)
    .replace(/<!-- ANALYTICS:START -->[\s\S]*?<!-- ANALYTICS:END -->/, `<!-- ANALYTICS:START -->${analyticsSnippet()}<!-- ANALYTICS:END -->`);
  fs.writeFileSync(fp, out);
  console.log('  stamped', f, '-> v=' + ASSET_VER);
});

/* sitemap */
const urls = [
  `${SITE_URL}/`, `${SITE_URL}/h1b-odds/`, `${SITE_URL}/visa/`, `${SITE_URL}/guides/`, `${SITE_URL}/contact.html`, `${SITE_URL}/privacy.html`, `${SITE_URL}/terms.html`,
  ...items.map(it => `${SITE_URL}/visa/${it.slug}/`),
  ...GUIDES.map(g => `${SITE_URL}/guide/${g.slug}/`)
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);
console.log('  wrote sitemap.xml (' + urls.length + ' urls)');
console.log('Done. Asset version: ' + ASSET_VER);
