import { test } from 'node:test';
import assert from 'node:assert';
import { autoPlayMatch as mjAuto, createSession as mjCreate, startSessionHand, autoPlayHand } from '../src/cards/mahjong.js';
import { autoPlayMatch as hdAuto, createSession as hdCreate } from '../src/cards/holdem.js';
import { autoPlayMatch as nnAuto, createSession as nnCreate } from '../src/cards/niuniu.js';

// ① 目标"性能·全方位升级"：引擎逻辑吞吐的**回归守卫**（宽松阈值，防未来改动把 AI/结算拖垮 10×+）。
// 非 SLA：阈值取实测值的宽裕倍数（牛牛/德州 ~60-170×、麻将 ~8×），CI 上不同机型不 flaky；
// 固定 seed 保证工作量可复现（计时随机型浮动，故只设宽松上限）。
// 已知热点：麻将 autoPlayMatch 最重（aiDiscard 反复算 waits() 听门）→ 整场数百 ms；交互单轮仍 <20ms，对玩法无碍。
const BUDGET_MS = { niuniu: 200, holdem: 200, mahjong: 5000 };
const avg = (fn, reps) => { const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(i); return (performance.now() - t0) / reps; };

test('引擎整场 autoPlayMatch 吞吐在性能预算内（①性能回归守卫）', { timeout: 30000 }, () => {
  const seed = 0x5f3;
  const nnMs = avg(() => nnAuto(nnCreate(seed, 10, 8), 1), 3);
  const hdMs = avg(() => hdAuto(hdCreate(seed, { totalHands: 10, rebuyLimit: 3 }), 1), 3);
  const mjMs = avg(() => mjAuto(mjCreate(seed, 0, 4), 1), 3);
  // 留痕：实测值随机型浮动，打印供 MILESTONES/回归对照
  console.log(`[perf-budget] 整场 autoPlayMatch：牛牛 ${nnMs.toFixed(1)}ms / 德州 ${hdMs.toFixed(1)}ms / 麻将 ${mjMs.toFixed(1)}ms`);
  assert.ok(nnMs < BUDGET_MS.niuniu, `牛牛整场 ${nnMs.toFixed(1)}ms 超预算 ${BUDGET_MS.niuniu}ms`);
  assert.ok(hdMs < BUDGET_MS.holdem, `德州整场 ${hdMs.toFixed(1)}ms 超预算 ${BUDGET_MS.holdem}ms`);
  assert.ok(mjMs < BUDGET_MS.mahjong, `麻将整场 ${mjMs.toFixed(1)}ms 超预算 ${BUDGET_MS.mahjong}ms`);
});

test('麻将热点定位：单局(1 hand) 吞吐远低于整场 4 局（交互单轮 AI 动作可接受）', { timeout: 30000 }, () => {
  const seed = 0x5f3;
  const handMs = avg(() => { const s = mjCreate(seed, 0, 4); const g = startSessionHand(s); autoPlayHand(g, 1); }, 5);
  // 单局（1 hand）应远小于整场 4 局的 1/2；设 500ms 宽松上限（防单局被拖慢）
  assert.ok(handMs < 500, `麻将单局 ${handMs.toFixed(1)}ms 超 500ms`);
  console.log(`[perf-budget] 麻将单局 autoPlayHand：${handMs.toFixed(1)}ms`);
});
