/* ============================================================
   一键跑全部测试 —— **每文件独立实例**，绝不碰 8765 正式对局
   ------------------------------------------------------------
   用法：node runtests.mjs
   原理：每个测试文件起一份独立的 server.mjs（独立端口 + 独立密钥文件），
        跑完即销毁 → ① 你正在 8765 上玩的局不会被 /api/reset 清空
                ② 测试之间零状态干扰
   为什么必须独立实例：共享实例时 paneltest（jsdom 渲染 + 页面轮询）
     会随机 ECONNRESET，而**单独跑必过** → 跨文件状态干扰，根因见
     测试稳定性排查记录.md
   ============================================================ */
import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT0 = 8767;
const FILES = [
  ['e2etest.mjs', []], ['uitest.mjs', []], ['multitest.mjs', []],
  ['paneltest.mjs', ['player']], ['paneltest.mjs', ['teacher']], ['submittest.mjs', []],
  ['competitiontest.mjs', []], ['negotiationtest.mjs', []], ['proposaltest.mjs', []],
  ['investtest.mjs', []], ['ruletest.mjs', []], ['markettest.mjs', []],
  ['demandtest.mjs', []], ['routetest.mjs', []], ['timetest.mjs', []], ['cabintest.mjs', []],
];

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** 起一份隔离实例；端口被占则自动向后顺延 */
async function startInstance(port, keyfile) {
  if (existsSync(join(HERE, keyfile))) { try { unlinkSync(join(HERE, keyfile)); } catch {} }
  for (let p = port; p < port + 60; p++) {
    const proc = spawn(process.execPath, [join(HERE, 'server.mjs')], {
      env: { ...process.env, PORT: String(p), SANDBOX_KEY_FILE: keyfile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let dead = false;
    proc.on('exit', () => { dead = true; });
    let err = '';
    proc.stderr.on('data', d => { err += d; });
    for (let i = 0; i < 100; i++) {
      await wait(150);
      if (dead) { if (/EADDRINUSE/.test(err)) break; throw new Error('实例启动失败: ' + err.slice(0, 200)); }
      try {
        const r = await fetch(`http://127.0.0.1:${p}/`, { headers: { 'x-sandbox-key': 'x' } });
        if (r.status) return { proc, port: p, base: `http://127.0.0.1:${p}` };
      } catch { /* retry */ }
    }
    proc.kill();
    await wait(120);
  }
  throw new Error('找不到可用端口（自 ' + port + ' 起 60 个均被占用）');
}

let failed = 0;
let port = PORT0;
for (const [file, args] of FILES) {
  const label = file.replace('.mjs', '') + (args.length ? ' ' + args.join(' ') : '');
  const keyfile = `.sandbox-test-keys-${port}.json`;
  let inst = null;
  try {
    inst = await startInstance(port, keyfile);
  } catch (e) {
    console.log(`  ✗ ${label}  （实例启动失败：${e.message}）`);
    failed++; port++; continue;
  }
  const r = await new Promise(res => {
    const c = spawn(process.execPath, [join(HERE, file), ...args], {
      env: { ...process.env, SANDBOX_BASE: inst.base, SANDBOX_KEY_FILE: keyfile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', code => res({ code, out }));
  });
  inst.proc.kill();
  await wait(120);
  if (existsSync(join(HERE, keyfile))) { try { unlinkSync(join(HERE, keyfile)); } catch {} }
  port++;
  const lines = r.out.trim().split('\n').filter(Boolean);
  const tail = lines.slice(-2).join(' | ').trim();
  const bad = r.code !== 0
    || /(\d+)\s*失败/.test(r.out) && [...r.out.matchAll(/(\d+)\s*失败/g)].some(m => +m[1] > 0)
    || /^\s*✗/m.test(r.out);
  if (bad) { failed++; console.log(`  ✗ ${label}\n      ${tail}`); }
  else console.log(`  ✓ ${label}  ${tail}`);
}
console.log(failed ? `\n${failed} 个测试文件未通过` : '\n全部测试通过');
process.exit(failed ? 1 : 0);
