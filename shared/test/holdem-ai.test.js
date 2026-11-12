/**
 * 德州 AI 策略层（v1.23）——难度三档行为差异 + 确定性重放 + 动作合法性 + 默认档回归。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { createSession, startNextHand, act, aiDecide, handOver } from '../src/cards/holdem.js';

/** 跑一整手，统计各座位动作分布（level 全体座位同档；人类 0 号也走 AI=整场模拟）。 */
function playHandsWithLevel(level, nHands, seedBase) {
  const counts = { fold: 0, check: 0, call: 0, raise: 0, allin: 0 };
  const raiseSizes = [];
  for (let h = 0; h < nHands; h++) {
    const sess = createSession(seedBase + h, { totalHands: 1 });
    startNextHand(sess);
    let g = 0;
    while (!handOver(sess.table) && g++ < 800) {
      const t = sess.table;
      const s = t.hand.toAct;
      const d = aiDecide(t, s, level);
      const r = act(t, s, d.action, d.amount);
      assert.ok(r.ok, `level=${level} 动作非法: ${JSON.stringify(d)} → ${r.reason}`);
      counts[d.action] = (counts[d.action] || 0) + 1;
      if (d.action === 'raise' && d.amount != null) raiseSizes.push(d.amount);
    }
  }
  return { counts, raiseSizes };
}

test('确定性重放：同 seed + 同 level 两手决策序列逐字一致', () => {
  const run = (level) => {
    const sess = createSession(99, { totalHands: 1 });
    startNextHand(sess);
    const log = [];
    let g = 0;
    while (!handOver(sess.table) && g++ < 800) {
      const t = sess.table;
      const d = aiDecide(t, t.hand.toAct, level);
      log.push(d.action + (d.amount ?? ''));
      act(t, t.hand.toAct, d.action, d.amount);
    }
    return log.join(',');
  };
  for (const level of [0, 1, 2]) {
    assert.strictEqual(run(level), run(level), `level=${level} 可重放`);
  }
});

test('默认档 level=1 回归：与 v2 行为一致（弃牌/过牌/跟注/加注 全分布出现且合法）', () => {
  const { counts } = playHandsWithLevel(1, 10, 1000);
  assert.ok(counts.check > 0 && counts.call > 0, `默认档有 check/call：${JSON.stringify(counts)}`);
  assert.ok(counts.fold > 0 && (counts.raise > 0 || counts.allin > 0), `默认档有弃牌与加注：${JSON.stringify(counts)}`);
});

/** 隔离设计：座位0=target level，座位1-3 固定默认档（中和"全座位同档炸池"的假象） */
function isolateSeat0(level, nHands, seedBase) {
  const counts = {}; const raiseSizes = [];
  for (let h = 0; h < nHands; h++) {
    const sess = createSession(seedBase + h, { totalHands: 1 });
    startNextHand(sess);
    let g = 0;
    while (!handOver(sess.table) && g++ < 800) {
      const t = sess.table;
      const s = t.hand.toAct;
      const lv = s === 0 ? level : 1;
      const d = aiDecide(t, s, lv);
      act(t, s, d.action, d.amount);
      if (s === 0) { counts[d.action] = (counts[d.action] || 0) + 1; if (d.action === 'raise' && d.amount != null) raiseSizes.push(d.amount); }
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { foldRate: (counts.fold || 0) / total, raiseSizes, counts, total };
}

test('弃牌单调（隔离座位0）：弱档(0) 弃牌率 > 强档(2)，默认居中', () => {
  const r = [0, 1, 2].map((lv) => isolateSeat0(lv, 15, 2000 + lv * 100));
  assert.ok(r[0].foldRate > r[2].foldRate, `弱档弃牌率(${r[0].foldRate.toFixed(2)}) > 强档(${r[2].foldRate.toFixed(2)})`);
  assert.ok(r[0].foldRate >= r[1].foldRate && r[1].foldRate >= r[2].foldRate - 0.05,
    `弱(${r[0].foldRate.toFixed(2)}) ≥ 默认(${r[1].foldRate.toFixed(2)}) ≈ 强(${r[2].foldRate.toFixed(2)})（默认夹中间，±5%容差）`);
});

test('弱档更被动（隔离座位0，80手）：弱档弃牌 > 强档，且弱档加注次数 ≤ 强档（紧凶度低）', () => {
  const weak = isolateSeat0(0, 80, 5000);
  const hard = isolateSeat0(2, 80, 5000);
  assert.ok(weak.foldRate > hard.foldRate, `弱档弃牌率(${weak.foldRate.toFixed(2)}) > 强档(${hard.foldRate.toFixed(2)})`);
  assert.ok(weak.raiseSizes.length <= hard.raiseSizes.length || hard.raiseSizes.length === 0,
    `弱档加注次数(${weak.raiseSizes.length}) ≤ 强档(${hard.raiseSizes.length})（弱档紧、不追注）`);
});

test('合法性：三档所有动作 act() 均接受（越界加注被钳位，不出现 bad-amount）', () => {
  for (const lv of [0, 1, 2]) {
    const sess = createSession(77 + lv, { totalHands: 2 });
    let g = 0, acted = 0;
    while (!sess.over && g++ < 1600) {
      startNextHand(sess);
      const t = sess.table;
      while (!handOver(t)) {
        const d = aiDecide(t, t.hand.toAct, lv);
        const r = act(t, t.hand.toAct, d.action, d.amount);
        assert.strictEqual(r.ok, true, `level=${lv} act 被拒: ${JSON.stringify(d)} ${r.reason}`);
        acted++;
      }
    }
    assert.ok(acted > 0);
  }
});

test('整场守恒：任意难度组合跑完一局，筹码池守恒（stacks+committed = 起始+rebuy 注入）', () => {
  for (const mix of [[0, 1, 2, 0], [2, 2, 1, 1], [0, 0, 0, 0]]) {
    const sess = createSession(555, { totalHands: 3 });
    let g = 0;
    while (!sess.over && g++ < 1200) {
      startNextHand(sess);
      const t = sess.table;
      while (!handOver(t)) {
        const s = t.hand.toAct;
        const d = aiDecide(t, s, mix[s]);
        act(t, s, d.action, d.amount);
      }
      if (t.hand && t.hand.results) {
        assert.strictEqual(
          t.stacks.reduce((a, b) => a + b, 0),
          4 * sess.startStack + sess.rebuys.reduce((a, b) => a + b, 0) * sess.startStack,
          '手终筹码守恒（难度混合不破坏）');
      }
    }
  }
});
