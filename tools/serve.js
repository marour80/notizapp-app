/*
 * Mini-Webserver für die PWA-/Web-Version.
 * Startet die App aus dem Ordner src/ unter http://localhost:8080
 * Ausführen mit:  node tools/serve.js   (dann im Browser öffnen)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Alle echten LAN-IPv4-Adressen, Heim-WLAN-Bereiche zuerst (Tailscale/VPN 100.x ans Ende).
function lanIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  const rank = (ip) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : ip.startsWith('100.') ? 4 : 3;
  return out.sort((a, b) => rank(a) - rank(b));
}

const ROOT = path.join(__dirname, '..', 'src');
const PORT = process.env.PORT || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function handler(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found: ' + rel);
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// Bei belegtem Port automatisch den nächsten probieren (statt abzustürzen).
function start(port, attemptsLeft) {
  const server = http.createServer(handler);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log('Port ' + port + ' ist belegt – versuche ' + (port + 1) + ' …');
      start(port + 1, attemptsLeft - 1);
    } else {
      console.error('Server-Fehler:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    const ips = lanIPs();
    console.log('');
    console.log('  ✦ NotizApp Web läuft!');
    console.log('  → Auf diesem PC:   http://localhost:' + port);
    if (ips[0]) console.log('  → Fürs Handy:      http://' + ips[0] + ':' + port + '  (gleiches WLAN)');
    if (ips.length > 1) {
      console.log('     Klappt das nicht, probiere eine dieser Adressen:');
      ips.slice(1).forEach((ip) => console.log('       http://' + ip + ':' + port));
    }
    console.log('');
    console.log('  Zum Beenden: Strg + C');
  });
}

start(PORT, 10);
