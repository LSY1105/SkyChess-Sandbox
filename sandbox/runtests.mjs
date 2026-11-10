/* ============================================================
   一键跑全部测试 —— **隔离实例**，绝不碰 8765 正式对局
   ------------------------------------------------------------
   用法：node runtests.mjs
   原理：在 8767 端口另起一份 server.mjs（独立密钥文件），
        所有测试通过 SANDBOX_BASE / SANDBOX_KEY_FILE 指向它，
        跑完即销毁 → 你正在 8765 上玩的局不会被 /api/reset 清空。
   ============================================================ */
import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8767;
const BASE = `http://127.0.0.1:${PORT}`;
const KEYFILE = '.sandbox-test-keys.json';

const FILES = [
  ['e2etest.mjs', []], ['uitest.mjs', []], ['multitest.mjs', []],
  ['paneltest.mjs', ['player']], ['paneltest.mjs', ['teacher']],
  ['competitiontest.mjs', []], ['negotiationtest.mjs', []], ['proposaltest.mjs', []],
  ['investtest.mjs', []], ['ruletest.mjs', []], ['markettest.mjs', []],
  ['demandtest.mjs', []], ['routetest.mjs', []], ['timetest.mjs', []], ['cabintest.mjs', []],
];

if (existsSync(join(HERE, KEYFILE))) unlinkSync(join(HERE, KEYFILE));
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), SANDBOX_KEY_FILE: KEYFILE },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', d => { if (/listening|教师|玩家/.test(String(d))) process.stdout.write('  [srv] ' + d); });
srv.stderr.on('data', d => process.stderr.write('  [srv!] ' + d));

const wait = (ms) => new Promise(r => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 60; i++) {
  await wait(300);
  try { const r = await fetch(BASE + '/', { headers: { 'x-sandbox-key': 'x' } }); if (r.status) { up = true; break; } } catch { /* retry */ }
}
if (!up) { console.error('测试服务器启动失败'); srv.kill(); process.exit(1); }
console.log(`隔离测试服务器已就绪 ${BASE}\n`);

let failed = 0;
for (const [file, args] of FILES) {
  const label = file.replace('.mjs', '') + (args.length ? ' ' + args.join(' ') : '');
  const r = await new Promise(res => {
    const c = spawn(process.execPath, [join(HERE, file), ...args], {
      env: { ...process.env, SANDBOX_BASE: BASE, SANDBOX_KEY_FILE: KEYFILE },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => res({ code, out }));
  });
  const tail = r.out.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
  // 失败判定：退出码非 0，或出现非零失败数，或行首 ✗
  const failCounts = [...r.out.matchAll(/(\d+)\s*失败/g)].map(m => +m[1]);
  const bad = r.code !== 0 || failCounts.some(n => n > 0) || /^\s*✗/m.test(r.out);
  if (bad) { failed++; console.log(`  ✗ ${label}\n      ${tail}`); }
  else console.log(`  ✓ ${label}  ${tail}`);
}
srv.kill();
if (existsSync(join(HERE, KEYFILE))) unlinkSync(join(HERE, KEYFILE));
console.log(failed ? `\n${failed} 个测试文件未通过` : '\n全部测试通过');
process.exit(failed ? 1 : 0);
