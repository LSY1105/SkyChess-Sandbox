import http from 'node:http';
import { readFileSync } from 'fs';
const BASE = 'http://127.0.0.1:8768';
const KEYS = JSON.parse(readFileSync('./.sandbox-test-keys.json', 'utf8'));
function nf(url, opt = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ agent: false, host: u.hostname, port: u.port, path: u.pathname + u.search,
      method: opt.method || 'GET', headers: { ...(opt.headers || {}), 'content-length': opt.body ? Buffer.byteLength(opt.body) : 0 } },
      res => { let s = ''; res.on('data', d => s += d); res.on('end', () => resolve({ status: res.statusCode, body: s })); });
    req.on('error', reject); if (opt.body) req.write(opt.body); req.end();
  });
}
const H = { 'content-type': 'application/json', 'x-sandbox-key': KEYS.seats.CA };
try {
  let r = await nf(BASE + '/api/seat/CA', { headers: H });
  const gh = JSON.parse(r.body);
  const acId = gh.game.aircraft[0].id;
  console.log('1 GET ok', r.status);
  r = await nf(BASE + '/api/seat/CA', { method: 'POST', headers: H, body: JSON.stringify({ type: 'addFlight', acId, code: 'SIM', departure: '07:00' }) });
  console.log('2 addFlight', r.status, r.body.slice(0, 60));
  r = await nf(BASE + '/api/seat/CA', { method: 'POST', headers: H, body: JSON.stringify({ type: 'advance' }) });
  console.log('3 advance', r.status, 'body len', r.body.length);
  r = await nf(BASE + '/api/seat/CA', { headers: H });
  console.log('4 GET history', JSON.parse(r.body).game.history.length);
} catch (e) { console.log('ERROR at:', e.code || e.message); }
