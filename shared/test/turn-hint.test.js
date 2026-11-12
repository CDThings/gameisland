import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession as mjSession, startSessionHand, turnHint as mjHint
} from '../src/cards/mahjong.js';
import {
  createSession as hdSession, startNextHand, handOver, turnHint as hdHint
} from '../src/cards/holdem.js';
import {
  createSession as nnSession, startRound, settleRound, turnHint as nnHint
} from '../src/cards/niuniu.js';

// ── 麻将：与真实对局状态一致（无论是否天胡终局）+ 合成态覆盖 claim/discard/settling 分支 ──
test('麻将 turnHint：与对局状态一致 + 分支覆盖', () => {
  for (const seed of [42, 7, 123, 999]) {
    const g = startSessionHand(mjSession(seed, 0, 4));
    const h = mjHint(g);
    if (g.phase === 'over') {
      assert.deepEqual(h, { activeSeat: -1, kind: 'done' }, `seed=${seed} 天胡终局`);
    } else {
      assert.equal(h.activeSeat, g.turn, `seed=${seed} activeSeat=当前打牌座`);
      assert.equal(h.kind, g.turn === g.humanSeat ? 'your-turn' : 'ai-turn', `seed=${seed} kind 与 humanSeat 比对`);
    }
  }
  // 合成态：claim 轮（响应方）/ discard 轮 / settling / done / idle
  assert.deepEqual(mjHint({ humanSeat: 1, phase: 'claim', claimPending: { cur: 2 } }), { activeSeat: 2, kind: 'ai-turn' });
  assert.deepEqual(mjHint({ humanSeat: 0, phase: 'claim', claimPending: { cur: 0 } }), { activeSeat: 0, kind: 'your-turn' });
  assert.deepEqual(mjHint({ humanSeat: 0, phase: 'discard', turn: 3 }), { activeSeat: 3, kind: 'ai-turn' });
  assert.deepEqual(mjHint({ humanSeat: 0, phase: 'discard', turn: 0 }), { activeSeat: 0, kind: 'your-turn' });
  assert.deepEqual(mjHint({ phase: 'over' }), { activeSeat: -1, kind: 'done' });
  assert.deepEqual(mjHint({ humanSeat: 0, phase: 'weird' }), { activeSeat: -1, kind: 'settling' });
  assert.deepEqual(mjHint(null), { activeSeat: -1, kind: 'idle' });
});

// ── 德州：合成态覆盖 摊前行动座/已摊结算/整场结束 + 真实 startNextHand 一致性 ──
test('德州 turnHint：行动座/摊牌结算/整场结束 分支', () => {
  assert.deepEqual(hdHint({ over: false, table: { humanSeat: 0, hand: { results: null, toAct: 0 } } }), { activeSeat: 0, kind: 'your-turn' });
  assert.deepEqual(hdHint({ over: false, table: { humanSeat: 0, hand: { results: null, toAct: 2 } } }), { activeSeat: 2, kind: 'ai-turn' });
  assert.deepEqual(hdHint({ over: false, table: { humanSeat: 0, hand: { results: {}, toAct: 1 } } }), { activeSeat: -1, kind: 'settling' });
  assert.deepEqual(hdHint({ over: false, table: { humanSeat: 0, hand: null } }), { activeSeat: -1, kind: 'settling' });
  assert.deepEqual(hdHint({ over: true, table: { hand: null } }), { activeSeat: -1, kind: 'done' });
  assert.deepEqual(hdHint(null), { activeSeat: -1, kind: 'idle' });
  // 真实开局：摊前 activeSeat 必为 0-3 活座，且 kind 与 humanSeat 比对一致
  for (const seed of [1, 5, 88]) {
    const se = hdSession(seed, { totalHands: 10, rebuyLimit: 3 });
    startNextHand(se);
    if (!handOver(se.table)) {
      const h = hdHint(se);
      assert.ok(h.activeSeat >= 0 && h.activeSeat <= 3, `seed=${seed} 活座`);
      assert.equal(h.kind, h.activeSeat === se.table.humanSeat ? 'your-turn' : 'ai-turn');
    }
  }
});

// ── 牛牛：同时亮牌制，结算前恒 your-turn(座0)，结算后 done，无对局 idle ──
test('牛牛 turnHint：结算前/结算后/无对局', () => {
  assert.deepEqual(nnHint(null), { activeSeat: -1, kind: 'idle' });
  const se = nnSession(99, 10, 2);
  startRound(se);
  assert.deepEqual(nnHint(se.round), { activeSeat: 0, kind: 'your-turn' });
  assert.deepEqual(nnHint({ settled: null }), { activeSeat: 0, kind: 'your-turn' });
  settleRound(se);
  assert.deepEqual(nnHint(se.round), { activeSeat: -1, kind: 'done' });
});
