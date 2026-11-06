/* ============================================================
   航线「飞行距离 × 飞行时间」一致性核查 + 回归
   rebuild/audit_route_time.mjs
   ------------------------------------------------------------
   口径（2026-11-04 核查确定）：bh = **单程** Block Hours
     · 单程时长 = bh；去程到达 = 起飞 + bh；回程起飞 = 去程到达 + 过站；回程到达 = +bh
     · 同机两班最小间隔 = 2×bh + 周转（去-回-周转）
     · 短程每机每日班次上限 = floor((可用时段16h − 2×bh) ÷ (2×bh + 周转))；远程机型恒 1 班/日
   判据：
     ① 隐含巡航速度 = 距离 ÷ 单程时长，须落在 300–900 km/h（含起降滑行的合理区间）
     ② 每条航线的距离 > 0、bh > 0
     ③ 超长航线（≥3000km）每日仅 1 班/日（须远程机型 + 过夜）
   运行：node rebuild/audit_route_time.mjs        （输出表 + 写 route_time_audit.json）
   ============================================================ */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as D from '../sandbox/data.js';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const STYLE_TURN = { LCC: 30, Hybrid: 40, FSC: 60 };
const DAY_WINDOW_H = 16;          // 短程可用时段 06:00–22:00

export function auditRoutes() {
  const rows = Object.entries(D.MARKETS).map(([code, m]) => {
    const legH = m.bh;                              // 单程 Block Hours
    const spd = m.sector_km / legH;                 // 隐含巡航速度 km/h
    const perDay = {};
    const remoteOnly0 = m.sector_km >= 3000;
    for (const [s, turn] of Object.entries(STYLE_TURN)) {
      const fits = Math.floor((DAY_WINDOW_H - 2 * legH) / (2 * legH + turn / 60));
      perDay[s] = remoteOnly0 ? 1 : Math.max(0, Math.min(2, fits));   // 远程机型：过夜，恒 1 班/日
    }
    const remoteOnly = m.sector_km >= 3000;         // 超长航线须远程机型（过夜，恒 1 班/日）
    return {
      code, name: m.name_cn || m.name, km: m.sector_km, bh: m.bh,
      legMin: Math.round(legH * 60), spd: Math.round(spd),
      etops: !!m.esg_required, remoteOnly, perDay,
      occupancyH: +(2 * legH).toFixed(2),            // 单日往返占用（不含过站）
    };
  }).sort((a, b) => a.km - b.km);

  const issues = [];
  for (const r of rows) {
    if (!(r.km > 0) || !(r.bh > 0)) issues.push(`${r.code}: 距离或 BH 非法`);
    if (r.spd < 300 || r.spd > 900) issues.push(`${r.code}: 隐含速度 ${r.spd} km/h 超出 300–900`);
    if (r.remoteOnly && r.perDay.FSC < 1) issues.push(`${r.code}: 超长航线每日班次上限应为 1`);
  }
  // 单调性：原版数据在 CHA→ETN、BZY→GEE 处逆序（属原版设定，只记录不判失败）
  const inversions = [];
  for (let i = 1; i < rows.length; i++)
    if (rows[i].bh < rows[i - 1].bh) inversions.push(`${rows[i - 1].code}(${rows[i - 1].km}km/${rows[i - 1].bh}h) → ${rows[i].code}(${rows[i].km}km/${rows[i].bh}h)`);

  return { rows, issues, inversions, dayWindowH: DAY_WINDOW_H };
}

if (process.argv[1] && process.argv[1].endsWith('audit_route_time.mjs')) {
  const r = auditRoutes();
  console.log('航线                距离km  单程BH  单程min  隐含速度  ETOPS  每日班次(LCC/Hybrid/FSC)  单日往返占用');
  for (const x of r.rows)
    console.log(`${(x.name + '(' + x.code + ')').padEnd(18)} ${String(x.km).padStart(6)} ${String(x.bh).padStart(8)} ${String(x.legMin).padStart(8)} ${String(x.spd).padStart(9)} ${(x.etops ? ' 是' : ' 否').padStart(6)}  ${(x.perDay.LCC + '/' + x.perDay.Hybrid + '/' + x.perDay.FSC).padStart(20)}  ${x.occupancyH}h`
      + (x.remoteOnly ? '  ← 须远程机型执飞' : ''));
  console.log('');
  console.log('① 校验问题：' + (r.issues.length ? r.issues.join('; ') : '无 ✓'));
  console.log('② 距离↑但单程BH↓（原版设定，仅记录）：' + (r.inversions.length ? r.inversions.join('; ') : '无'));
  writeFileSync(join(HERE, 'rebuild', 'route_time_audit.json'), JSON.stringify(r, null, 2));
  console.log('已写入 rebuild/route_time_audit.json');
}
