/* Broonzy 的 K：两锚点插值 + 误差传播 → 中心值与区间（替代无法验证的单一值）
   锚点：Armstrong 65,860（原版 CA Q3'2028 notes「LF 100%」反解，与现值 68,505 互证）
        McGee    59,332（原版 VA Q2'2028 独飞 McGee 收入/margin 反解，已落地）
   方法：需求随航段距离递减 → K 对 ln(航段) 做对数线性插值（两锚点定线）
   不确定度：① 锚点各自 ±5% ② 货量维度（BZY 货量 30 最高，GEE 12 / ARM 12 → 客源结构不同）→ ±40% */
import { writeFileSync } from 'fs';
const A = { code:'ARM', km:3780, K:65860, note:"原版 CA Q3'2028 notes「Armstrong LF 100%」反解" };
const B = { code:'GEE', km:5265, K:59332, note:"原版 VA Q2'2028 独飞 McGee（fare 825 / pretax 6.40M / margin 40.2%）反解" };
const T = { code:'BZY', km:4473, cargo:30, note:'原版无 Broonzy 经营记录 → 无一手锚点' };
const x = Math.log(T.km), xa = Math.log(A.km), xb = Math.log(B.km);
const f = (xb - x) / (xb - xa);                      // BZY 在两锚点间的对数位置
const lnK = Math.log(A.K) + (Math.log(B.K) - Math.log(A.K)) * f;
const center = Math.round(Math.exp(lnK));
const anchorUnc = 0.05, cargoUnc = 0.40;
const lo = Math.round(center * (1 - anchorUnc) * (1 - cargoUnc));
const hi = Math.round(center * (1 + anchorUnc) * (1 + cargoUnc));
console.log('== Broonzy K 区间估计【模拟产出·非一手数据】==');
console.log(`锚点 A: ${A.code} ${A.km}km → K ${A.K.toLocaleString()}（${A.note}）`);
console.log(`锚点 B: ${B.code} ${B.km}km → K ${B.K.toLocaleString()}（${B.note}）`);
console.log(`目标:   ${T.code} ${T.km}km（货量 ${T.cargo}，全沙盘最高）→ ${T.note}`);
console.log(`对数位置 f=${f.toFixed(3)} → K 中心值 ${center.toLocaleString()}`);
console.log(`不确定度：锚点 ±${(anchorUnc*100).toFixed(0)}% × 货量维度 ±${(cargoUnc*100).toFixed(0)}%`);
console.log(`→ 区间 [${lo.toLocaleString()}, ${hi.toLocaleString()}]（宽度约 ${(hi/lo).toFixed(1)}×）`);
console.log(`现值 26,953 → 落在区间下方 ${(center/26953).toFixed(1)}× → 现值明显偏小`);
console.log('注：不写入 engine.js —— 无一手锚点，且区间过宽（4×），落地会污染首季对账护栏；');
console.log('    建议在课堂材料中作为「Broonzy 市场需求未知」的教学点保留。');
writeFileSync('rebuild/broonzy_k_estimate.json', JSON.stringify({
  generatedAt: new Date().toISOString(), tag:'【模拟产出·非一手数据】',
  anchors:[A,B], target:T, logPosition:+f.toFixed(4), center, range:[lo,hi],
  current: 26953, note:'不落地：区间宽 4×，无一手锚点；保留为教学点',
}, null, 2));
console.log('已写入 rebuild/broonzy_k_estimate.json');
