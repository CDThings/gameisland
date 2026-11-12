/**
 * 牛牛 AI 策略层（v1.23）——确定性 / 难度单调 / 合法性 / 翻倍意向 / 结算不变。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createRound, settle, bestNiu, aiNiuPlan, allPlans, wantsDouble, rankOf } from '../src/cards/niuniu.js';
import { mulberry32 } from '../src/rng.js';

function roundOf(seed) {
  const r = createRound(seed, 10);
  return r;
}

test('level=2 恒等于 bestNiu（最优，向后兼容）', () => {
  for (const seed of [1, 7, 42, 99, 2026]) {
    const r = roundOf(seed);
    for (let seat = 0; seat < 4; seat++) {
      const p = aiNiuPlan(r.hands[seat], 2, mulberry32(seed ^ seat));
      assert.strictEqual(rankOf(p.niu).r * 100 + p.niu.niu, rankOf(bestNiu(r.hands[seat])).r * 100 + bestNiu(r.hands[seat]).niu, `seed=${seed} seat=${seat}`);
    }
  }
});

test('确定性：同 seed+level+seat 决策可重放', () => {
  const r = roundOf(555);
  for (const level of [0, 1]) {
    const a = aiNiuPlan(r.hands[1], level, mulberry32(555 ^ 1));
    const b = aiNiuPlan(r.hands[1], level, mulberry32(555 ^ 1));
    assert.deepStrictEqual(a.chosen, b.chosen, `level=${level} 可重放`);
    assert.strictEqual(rankOf(a.niu).r, rankOf(b.niu).r);
  }
});

test('level=0 弱 AI 存在严格劣于最优的排法（可被击败）', () => {
  let found = false;
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const r = roundOf(seed);
    for (let seat = 0; seat < 4; seat++) {
      const p = aiNiuPlan(r.hands[seat], 0, mulberry32(seed ^ seat));
      const best = bestNiu(r.hands[seat]);
      if (rankOf(p.niu).r * 100 + (p.niu.type === 'niu' ? p.niu.niu : 0) < rankOf(best).r * 100 + (best.type === 'niu' ? best.niu : 0)) found = true;
    }
  }
  assert.ok(found, '60 seed × 4 座内必出现弱 AI 劣于最优的排法');
});

test('难度单调（聚合牌型值：弱≤中≤强）', () => {
  const sum = [0, 0, 0];
  for (let seed = 1; seed <= 40; seed++) {
    const r = roundOf(seed);
    for (let level = 0; level <= 2; level++) {
      for (let seat = 0; seat < 4; seat++) {
        const p = aiNiuPlan(r.hands[seat], level, mulberry32(seed ^ seat ^ level));
        sum[level] += rankOf(p.niu).r;
      }
    }
  }
  assert.ok(sum[0] <= sum[1] && sum[1] <= sum[2], `聚合牌型值 弱(${sum[0]}) ≤ 中(${sum[1]}) ≤ 强(${sum[2]})`);
});

test('chips 不破坏：策略排法下的互赔结算仍严格零和', () => {
  for (const seed of [3, 11, 27]) {
    const r = roundOf(seed);
    // 各座按 level=0 策略排法（含劣排）
    for (let seat = 0; seat < 4; seat++) {
      const p = aiNiuPlan(r.hands[seat], 0, mulberry32(seed ^ seat));
      r.arr[seat] = p.chosen;
    }
    const res = settle(r);
    assert.strictEqual(res.deltas.reduce((a, b) => a + b, 0), 0, `seed=${seed} 策略排法仍零和`);
  }
});

test('wantsDouble：大牌型(≥牛牛)→true，无牛/低牛→false', () => {
  assert.strictEqual(wantsDouble({ type: 'niuniu', niu: 10 }), true);
  assert.strictEqual(wantsDouble({ type: 'zhadan' }), true);
  assert.strictEqual(wantsDouble({ type: 'wuxiao' }), true);
  assert.strictEqual(wantsDouble({ type: 'niu', niu: 3 }), false);
  assert.strictEqual(wantsDouble({ type: 'none', niu: 0 }), false);
});
