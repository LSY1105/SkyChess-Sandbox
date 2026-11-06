/* 舱位分级（S3）专项测试 */
import { allocateCabin } from './game.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

// ① 三舱同价 → 与「单一票价」完全一致（不破坏既有标定）
{
  const r = allocateCabin({ Y: 80, W: 12, J: 8 }, { Y: 100, W: 100, J: 100 }, 60);
  ok(r.mix.J === 8 && r.mix.W === 12 && r.mix.Y === 40, '同价时按 J→W→Y 顺序售出');
  ok(Math.abs(r.rev - 60 * 100) < 1e-9, `同价时收入 = pax×单价（${r.rev} = 6000）`);
  ok(r.leftover === 0, '无余量');
}
// ② 高价舱位优先售出
{
  const r = allocateCabin({ Y: 80, W: 12, J: 8 }, { Y: 100, W: 200, J: 400 }, 60);
  ok(r.mix.J === 8 && r.mix.W === 12 && r.mix.Y === 40, '高价舱位先坐满（J 8 + W 12）');
  ok(Math.abs(r.rev - (8 * 400 + 12 * 200 + 40 * 100)) < 1e-9, `收入按各舱位票价合计（${r.rev} = 9600）`);
}
// ③ 需求不足 → 余量由低价舱位承接；高价舱位坐不满则仍高价卖
{
  const r = allocateCabin({ Y: 80, W: 12, J: 8 }, { Y: 100, W: 200, J: 400 }, 5);
  ok(r.mix.J === 5 && r.mix.W === 0 && r.mix.Y === 0, '需求只够 5 人 → 全部进最高价公务舱');
  ok(Math.abs(r.rev - 5 * 400) < 1e-9, '收入按最高价舱位计（2000）');
}
{
  const r = allocateCabin({ Y: 80, W: 0, J: 0 }, { Y: 100, W: 200, J: 400 }, 90);
  ok(r.leftover === 10, '座位不足时余量 10 交由上层兜底');
}
// ④ 分时倍率对各舱位一视同仁
{
  const r = allocateCabin({ Y: 100, W: 0, J: 0 }, { Y: 100, W: 200, J: 400 }, 50, 1.2);
  ok(Math.abs(r.rev - 50 * 100 * 1.2) < 1e-9, '高峰倍率 1.2 同步作用于各舱位');
}
console.log(`\n舱位分级专项：${pass} 通过 / ${fail} 失败 / 共 ${pass + fail}`);
process.exit(fail ? 1 : 0);
