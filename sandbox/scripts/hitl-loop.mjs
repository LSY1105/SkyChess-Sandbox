/* ============================================================
   人工复验循环（HITL）—— 把每轮人工验证**脚本化**
   ------------------------------------------------------------
   为什么需要它：11-18 ~ 11-19 连续三轮返工的共同根因是
   「**人眼看见了、自动化没看见**」。自动化补的是**确定性**检查，
   而「这个反馈学员到底看得见吗」只能由人判断 → 本脚本固定**步骤与记录格式**，
   避免每轮临时手写清单、也避免漏项。

   用法：
     node scripts/hitl-loop.mjs                 # 打印本轮清单 + 三个访问地址
     node scripts/hitl-loop.mjs --record "结论"   # 把本轮结论追加到 .hitl-log.md
   ============================================================ */
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = join(HERE, '..');
const BASE = process.env.SANDBOX_BASE || 'http://127.0.0.1:8765';

/* 课堂常驻复验项：每一轮都要过的
   ★ 分两组：① 通用课堂项（早期返工点）② 投资机制专项（11-18 ~ 11-19 三轮的返工点）
     —— 清单从 项目同步文档.md §8.3 ㉗–㉙ 的「修法」条目**反向生成**（一条修法 = 一条复验项） */
const STANDING = [
  '【通用】裁判端能开始本季计时；小组端顶栏显示「未开始计时 · 等待裁判开始本季计时」',
  '【通用】裁判端顶栏参数与小组端一致（油价 / 碳价 / 利率 / 中转强度）',
  '【通用】小组端排班：加班次 → 回程设定 → 提交（提交按钮只在裁判端）',
  '【通用】小组端全页不出现 NaN / undefined / LEW / SIM',
  '【通用】小组端**不闪动**（尤其裁判端开计时后）',
  '【通用】小组端下拉框能展开、能选中、主页面还能滚动',
  '【通用】联程设置的两个复选框能**取消勾选**',
  '【通用】裁判端经营模式设定：选 → 确定 → 回显**不回落**到「混合航空」',
  '【通用】小组端左右两列卡片数均衡（差 ≤1）',
  '【通用】小组端所有按钮可点（没有「点了没反应」的控件）',
  '【投资】裁判端投资项下拉：**选项文字看得全**（不被截断），且按类别分组',
  '【投资】裁判端状态行在**卡片顶部**、字号够大、颜色看得清',
  '【投资】裁判端状态行区分**四态**：默认开放 / 裁判指定开放 / 裁判关闭 / 原版未开放',
  '【投资】裁判端开关按钮**文案随状态翻转**（开放该项 ⇄ 关闭该项），且真的能关掉',
  '【投资】裁判端每次操作后**按钮旁**出现 ✔ 反馈（不用去别处找）',
  '【投资】裁判端手填的每客条款**不会被回显冲掉**（换一个动作触发回显后仍在）',
  '【投资】裁判端「已议定项清单」**可点**（点一行即载入表单）',
  '【投资】裁判端发放资金后，小组端顶栏现金**立即**变化',
  '【投资】小组端投资表每行有**裁判状态徽标**（开放 / 未开放 / 已议定）',
  '【投资】小组端投资卡顶部有**已投放小结**（含一次性 / 年费 / 每客成本·收益）',
  '【投资】小组端「📄 投资报表」一键到报表的**投资**页签且有数据',
  '【投资】小组端被拒原因**就地可见**（不只靠弹窗）',
  '【投资】小组端投资失败文案是**中文**（不是 no cash / already invested）',
  '【投资】报表投资项显示**中文名 + 目录英文名列**，每客成本/收益是**议定后**的值',
  '【投资】报表「更多报表」能展开；各页签有数据',
];

const KEYFILE = join(SANDBOX, '.sandbox-keys.json');
const keys = existsSync(KEYFILE) ? JSON.parse(readFileSync(KEYFILE, 'utf8')) : null;

console.log('\n════════ 人工复验清单（逐条回答：通过 / 不通过 + 现象）════════\n');
STANDING.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t}`));
console.log('\n──────── 访问地址（密钥见 sandbox/.sandbox-keys.json）────────');
if (keys) {
  console.log(`  裁判端   ${BASE}/teacher.html?key=${keys.teacher}`);
  for (const [seat, k] of Object.entries(keys.seats || {}))
    console.log(`  小组端 ${seat} ${BASE}/player.html?seat=${seat}&key=${k}`);
} else {
  console.log(`  裁判端   ${BASE}/teacher.html?key=<教师密钥>`);
  console.log(`  小组端   ${BASE}/player.html?seat=CA&key=<席位密钥>`);
}
console.log('\n把结论贴回对话；或用 --record 追加到台账：');
console.log('  node scripts/hitl-loop.mjs --record "2026-11-19 第2轮：1-12 通过"\n');

const rec = process.argv.includes('--record')
  ? process.argv[process.argv.indexOf('--record') + 1]
  : null;
if (rec) {
  const line = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${rec}\n`;
  /* ★ 台账放系统临时目录：落工作区会让 git status 变脏、还可能被误提交（AGENTS.md 已知坑） */
  const log = join(tmpdir(), 'skychess-hitl-log.md');
  appendFileSync(log, line, 'utf8');
  console.log('已记入 ' + log);
}
