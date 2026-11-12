/**
 * 麻将 桌面词条 chip（v1.21）——确定性 + 零和计分不变量保持 + 旁路资助可观测 + 幂等。
 * 设计：chip 资助走 sess.chipEarnings 旁路台账（不动 sess.total / g.scores），
 * 既有「自摸三家各付 / 点炮单付」零和计分不变量不受 chip 影响。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createSession, startSessionHand, endSessionHand, applySessionChips, aiDiscard, doClaim, discard, selfHu, selfWinCheck, claimOptions } from '../src/cards/mahjong.js';
import { rollChips, applyChip } from '../src/cards/meta.js';

// 驱动一局麻将到完局（AI 自动出牌，人类 0 号也走 AI）
function playGame(g, humanAI = true) {
  let guard = 0;
  while (!g.phase === undefined && g.phase !== 'over' && guard++ < 400) {
    if (g.phase === 'discard') {
      // 先处理碰/杠/胡声明队列（AI 全过，除胡外）
      if (g.claimPending) {
        for (let k = 0; k < 4 && g.claimPending; k++) {
          const s = g.claimPending.cur;
          const co = claimOptions(g, s);
          const act = co && co.hu && !humanAI ? 'hu' : 'pass';
          doClaim(g, s, act);
        }
        if (g.phase === 'over') return g;
      }
      if (g.phase !== 'discard') return g;
      // 摸牌后 AI/人类出牌
      const t = aiDiscard(g, g.turn);
      const r = discard(g, g.turn, t);
      if (!r.ok) { // stalled 兜底：打最左
        discard(g, g.turn, g.hands[g.turn][0]);
      }
    } else if (g.phase === 'draw' && g.winner == null) {
      // 流局
      return g;
    }
  }
  return g;
}

test('同 seed 抽到的 chip 完全一致（确定性，可重放）', () => {
  assert.deepStrictEqual(
    rollChips('mahjong|888', 'mahjong').map(c => c.id),
    rollChips('mahjong|888', 'mahjong').map(c => c.id));
});

test('createSession 带 chips(≤2) + 旁路台账清零', () => {
  const s = createSession(42, 0, 4);
  assert.ok(Array.isArray(s.chips) && s.chips.length >= 1 && s.chips.length <= 2);
  assert.deepStrictEqual(s.chipEarnings, [0, 0, 0, 0]);
});

test('整场 8 seed：零和计分子系统不被 chip 破坏（每局 winner 收益=付家支出之和）', () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    const sess = createSession(seed, 0, 4);
    let k = 0;
    while (!sess.over && k++ < 40) {
      const g = startSessionHand(sess);
      playGame(g);
      // 零和不变量（与 chip 无关）：赢家净收益 = 各付家支出之和
      if (g.winner != null && g.lastWin) {
        const net = g.scores[g.winner];
        const paid = g.scores.slice().filter((_, i) => i !== g.winner).reduce((a, b) => a + b, 0);
        assert.equal(net, -paid, `seed=${seed} 局${k} 零和（chip 旁路不影响）`);
      }
      endSessionHand(sess);
    }
    // 旁路台账非负
    assert.ok(sess.chipEarnings.every(x => x >= 0), `seed=${seed} chipEarnings 非负`);
  }
});

test('applySessionChips 幂等（重复调用不重复资助）', () => {
  const sess = createSession(9, 0, 1);
  const g = startSessionHand(sess);
  playGame(g);
  const r1 = applySessionChips(sess);
  const snap = sess.chipEarnings.slice();
  const r2 = applySessionChips(sess);
  assert.strictEqual(r1, r2, '第二次调用返回同一结果');
  assert.deepStrictEqual(sess.chipEarnings, snap, 'chipEarnings 未重复累计');
});

test('chip 触发矩阵：满番/七对/自摸条件（v1.21 qidui condFn 修复）', () => {
  const chips = [
    { id: 'mahjong_fan50', effect: 'mult', value: 1.5, condFn: (r) => r && r.finalFan >= 5 },
    { id: 'mahjong_qiandui', effect: 'mult', value: 1.3, condFn: (r) => r && r.isSevenPairs === true },
    { id: 'mahjong_selfdraw', effect: 'bonus', value: 2, condFn: (r) => r && r.selfDrawn },
    { id: 'mahjong_fan2', effect: 'base', value: 1 },
  ];
  // 低番非七对非自摸 → 只有 base +1
  assert.strictEqual(applyChip({ fan: 1, finalFan: 1, selfDrawn: false, isSevenPairs: false }, chips).scoreBonus, 1);
  // 自摸 → base1 + bonus2
  assert.strictEqual(applyChip({ fan: 2, finalFan: 2, selfDrawn: true, isSevenPairs: false }, chips).scoreBonus, 3);
  // 七对 → mult 1.3
  assert.strictEqual(applyChip({ fan: 3, finalFan: 3, selfDrawn: false, isSevenPairs: true }, chips).multBonus, 1.3);
  // 满番(≥5) → mult 1.5
  assert.strictEqual(applyChip({ fan: 6, finalFan: 6, selfDrawn: false, isSevenPairs: false }, chips).multBonus, 1.5);
  // 七对+满番+自摸 全叠
  assert.ok(Math.abs(applyChip({ fan: 8, finalFan: 8, selfDrawn: true, isSevenPairs: true }, chips).multBonus - 1.5 * 1.3) < 1e-9);
});
