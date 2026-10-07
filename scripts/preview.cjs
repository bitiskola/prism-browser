'use strict';
// UI preview only. Actual browsing requires Electron; this server has no profile access.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = { '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/styles.css': ['styles.css','text/css'] };
http.createServer((req,res) => {
  const item = files[new URL(req.url, 'http://localhost').pathname];
  if (!item) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': `${item[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(__dirname, '../renderer', item[0])).pipe(res);
}).listen(4317, '127.0.0.1', () => console.log('Prism UI preview: http://127.0.0.1:4317'));
