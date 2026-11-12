/**
 * 德州五档难度统一（v1.53）：引擎 aiDecide 补 3 地域 / 4 绝望两档
 *  - 3 地域：松凶"地方局"（加注 1.0 底池、偷牌 0.65、14 分起速 all-in）
 *  - 4 绝望：最大压迫（加注 1.4 底池、偷牌 0.8、最广 all-in 区）
 *  - 0-2 档代码路径零改动（默认 1=历史零回归由既有 holdem 测试钉住）
 * 钉死：合法性（act() 全接受）/ 确定性（同 seed 重放）/ 无负筹码 / 压迫梯度（按"总投入筹码"度量）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startNextHand, autoPlayHand, autoPlayMatch, handOver
} from '../src/cards/holdem.js';

/** 驱动整场，按手收集 history → 总投入筹码（pays 合计）与终局 stacks（确定性种子流） */
function driveMatch(seed, level, hands = 8) {
  const sess = createSession(seed, { totalHands: hands });
  let committed = 0;
  while (!sess.over && sess.handNo < hands) {
    startNextHand(sess);
    autoPlayHand(sess.table, level);
    assert.ok(handOver(sess.table), `seed=${seed} L${level} 第 ${sess.handNo} 手应打完（AI 行动全合法）`);
    committed += sess.table.history.reduce((sum, e) => sum + (e.pay || 0), 0);
  }
  return { sess, committed, stacks: [...sess.table.stacks] };
}

test('L3/L4 整场可打完：AI 行动全部合法（act 拒绝=卡手）且筹码有限无 NaN', () => {
  for (const seed of [1, 3, 5, 9]) {
    for (const level of [3, 4]) {
      const { sess, stacks } = driveMatch(seed, level);
      for (const s of stacks) assert.ok(Number.isFinite(s) && s >= 0, `seed=${seed} L${level} stacks 合法`);
      assert.ok(sess.over || sess.handNo >= 8, '整场正常推进');
    }
  }
});

test('L3/L4 确定性：同 seed 两次驱动 → stacks/冠军/总投入逐字节一致', () => {
  for (const seed of [11, 22]) {
    for (const level of [3, 4]) {
      const a = driveMatch(seed, level);
      const b = driveMatch(seed, level);
      assert.deepEqual(a.stacks, b.stacks, `L${level} stacks 可重放`);
      assert.equal(a.committed, b.committed, `L${level} 行动流可重放`);
      assert.equal(a.sess.champ, b.sess.champ, `L${level} 冠军可重放`);
    }
  }
});

test('无负筹码 / 无 NaN（L3/L4 结算合法）', () => {
  for (const seed of [2, 8]) {
    for (const level of [3, 4]) {
      const { sess, stacks } = driveMatch(seed, level);
      assert.ok(stacks.every(s => s >= 0), `L${level} 无负筹码`);
      assert.ok(sess.table.stacks.every(Number.isFinite), '无 NaN');
    }
  }
});

test('压迫梯度：按"总投入筹码"度量 L4 > L3 > L2（多 seed 聚合，确定性）', () => {
  let l2 = 0, l3 = 0, l4 = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    l2 += driveMatch(seed, 2).committed;
    l3 += driveMatch(seed, 3).committed;
    l4 += driveMatch(seed, 4).committed;
  }
  // 实测（seed 1-5, 8 手/场）：L2≈15k < L3≈101k < L4≈286k——绝望档全桌投入最大
  assert.ok(l4 > l3, `L4 总投入(${l4}) 应高于 L3(${l3})`);
  assert.ok(l3 > l2, `L3 总投入(${l3}) 应高于 L2(${l2})`);
});

test('L3 行为钉：14 分起速 all-in（多 seed 聚合，总投入 L3 ≥ L1，确定性）', () => {
  const sum = (level) => {
    let c = 0;
    for (const seed of [1, 2, 3, 4, 5]) c += driveMatch(seed, level).committed;
    return c;
  };
  assert.ok(sum(3) >= sum(1), 'L3 总投入应不少于 L1（14 分起速 all-in 效果）');
});

test('autoPlayMatch(sess, 4) 整场确定性：同 seed 两次 → 终局 stacks/champ 一致', () => {
  const a = autoPlayMatch(createSession(7, { totalHands: 8 }), 4);
  const b = autoPlayMatch(createSession(7, { totalHands: 8 }), 4);
  assert.deepEqual(a.table.stacks, b.table.stacks);
  assert.equal(a.champ, b.champ);
});
