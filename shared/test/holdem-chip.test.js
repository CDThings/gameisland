/**
 * 德州 桌面词条 chip（v1.21）——确定性 + 筹码守恒不变量保持 + 旁路资助可观测 + 幂等。
 * 设计：chip 资助走 sess.chipEarnings 旁路台账（不动 stacks），
 * 既有「整场 20 seed 筹码守恒」不变量（sum(stacks)===常数）不受 chip 影响。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createSession, startNextHand, act, aiDecide, handOver, applyHandChips } from '../src/cards/holdem.js';
import { rollChips, applyChip } from '../src/cards/meta.js';

function playMatch(sess) {
  let guard = 0;
  while (!sess.over && guard++ < 200) {
    startNextHand(sess);
    const t = sess.table;
    let g = 0;
    while (!handOver(t) && g++ < 800) {
      const s = t.hand.toAct;
      const d = aiDecide(t, s); // 全座位走 AI（测试目的=跑完整场，非人类策略）
      act(t, s, d.action, d.amount);
    }
  }
}

test('同 seed 抽到的 chip 完全一致（确定性，可重放）', () => {
  assert.deepStrictEqual(
    rollChips('holdem|777', 'holdem').map(c => c.id),
    rollChips('holdem|777', 'holdem').map(c => c.id));
});

test('createSession 带 chips(≤2) + 旁路台账清零', () => {
  const s = createSession(42, { totalHands: 3 });
  assert.ok(Array.isArray(s.chips) && s.chips.length >= 1 && s.chips.length <= 2);
  assert.deepStrictEqual(s.chipEarnings, [0, 0, 0, 0]);
});

test('整场 10 seed：stacks 严格守恒不变 + 资助仅入旁路台账', () => {
  for (const seed of [1, 3, 7, 11, 13, 17, 19, 23, 29, 31]) {
    const sess = createSession(seed, { totalHands: 4, startStack: 1000 });
    const total0 = 4000;
    playMatch(sess);
    const t = sess.table;
    // 守恒不变量（含 rebuy 注入：rebuy 次数×1000）
    const rebuyInject = sess.rebuys.reduce((a, b) => a + b, 0) * sess.startStack;
    assert.equal(t.stacks.reduce((a, b) => a + b, 0), total0 + rebuyInject, `seed=${seed} 筹码守恒（chips 不动 stacks）`);
    // 资助非负且只进旁路台账
    assert.ok(sess.chipEarnings.every(x => x >= 0), `seed=${seed} chipEarnings 非负`);
  }
});

test('applyHandChips 幂等（重复调用不重复资助）', () => {
  const sess = createSession(5, { totalHands: 1 });
  startNextHand(sess);
  const t = sess.table;
  let g = 0;
  while (!handOver(t) && g++ < 800) { const s = t.hand.toAct; act(t, s, aiDecide(t, s).action, aiDecide(t, s).amount); }
  const r1 = applyHandChips(sess);
  const snap = sess.chipEarnings.slice();
  const r2 = applyHandChips(sess);
  assert.strictEqual(r1, r2, '第二次调用返回同一结果对象');
  assert.deepStrictEqual(sess.chipEarnings, snap, 'chipEarnings 未重复累计');
});

test('牌型条件 condFn 完整（v1.21 修复：pair/straight/flush 不再恒触发）', () => {
  // 无 rank 上下文（弃牌赢）→ 三张牌型 chip 全不触发
  const chips = [
    { id: 'holdem_pair_5', effect: 'mult', value: 1.05, condFn: (r) => r && r.handRank != null && r.handRank >= 1 },
    { id: 'holdem_straight_8', effect: 'mult', value: 1.08, condFn: (r) => r && (r.handRank === 4 || r.handRank === 5) },
    { id: 'holdem_flush_10', effect: 'mult', value: 1.10, condFn: (r) => r && r.handRank === 5 },
  ];
  assert.strictEqual(applyChip({ handRank: null, wonOnFlop: false }, chips).multBonus, 1, 'handRank=null 时牌型 chip 不触发');
  assert.strictEqual(applyChip({ handRank: 1 }, chips).multBonus, 1.05, '一对 → 仅 pair chip');
  assert.ok(Math.abs(applyChip({ handRank: 4 }, chips).multBonus - 1.05 * 1.08) < 1e-9, '顺子 → pair+straight 双触发');
  assert.ok(Math.abs(applyChip({ handRank: 5 }, chips).multBonus - 1.05 * 1.08 * 1.10) < 1e-9, '同花 → pair+straight+flush 三触发');
});
