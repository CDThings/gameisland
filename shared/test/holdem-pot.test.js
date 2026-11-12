import { test } from 'node:test';
import assert from 'node:assert';
import { potBreakdown, splitPots } from '../src/cards/holdem.js';

// v1.31 德州 底池/边池构成说明（掼蛋信息密度参照）：splitPots 的边池拆解 + potBreakdown 展示包装

test('potBreakdown：无投注/摊牌后=空', () => {
  assert.deepEqual(potBreakdown({ hand: { committed: [0, 0, 0, 0], results: null } }), []);
  assert.deepEqual(potBreakdown({ hand: null }), []);
  assert.deepEqual(potBreakdown(null), []);
});

test('potBreakdown：单一底池（四家平注）= 1 主池', () => {
  const pots = potBreakdown({ hand: { committed: [10, 10, 10, 10], results: null } });
  assert.equal(pots.length, 1);
  assert.equal(pots[0].amount, 40);
  assert.deepEqual(pots[0].eligible, [0, 1, 2, 3]);
  assert.equal(pots[0].isMain, true);
});

test('potBreakdown：多层全下 → 边池+主池，金额和=committed 总和，eligible 正确', () => {
  const committed = [100, 500, 100, 300]; // 座位1 全下 500，座位3 投到 300，座位0/2 各 100
  const pots = potBreakdown({ hand: { committed, results: null } });
  // 层 = [100,300,500] → 3 池
  assert.equal(pots.length, 3);
  // 金额守恒：各池之和 = committed 总和
  assert.equal(pots.reduce((a, p) => a + p.amount, 0), committed.reduce((a, b) => a + b, 0));
  // 逐池 eligible（升序层）
  assert.deepEqual(pots[0].eligible, [0, 1, 2, 3], '最低层 4 家都够');
  assert.deepEqual(pots[1].eligible, [1, 3], '300 层仅座1/3');
  assert.deepEqual(pots[2].eligible, [1], '500 主池仅座1（全下最深）');
  assert.equal(pots[2].isMain, true, '主池=最高层');
  assert.equal(pots[0].isMain, false);
  // 与底层 splitPots 一致
  assert.equal(pots.length, splitPots(committed).filter(p => p.amount > 0).length);
});
