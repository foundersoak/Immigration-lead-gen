#!/usr/bin/env node
/* Minimal dependency-free static server for local preview of the generated site. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(fp, (e, st) => {
    if (!e && st.isDirectory()) fp = path.join(fp, 'index.html');
    else if (e && !path.extname(fp)) fp = path.join(fp, 'index.html');
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + p); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}).listen(PORT, () => console.log('GreenCardETA preview on http://localhost:' + PORT));
