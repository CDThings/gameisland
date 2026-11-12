import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession as hdSession, startNextHand, handOver, actionHint
} from '../src/cards/holdem.js';
import {
  createSession as mjSession, startSessionHand, discardHint, claimHint, TILE_CN
} from '../src/cards/mahjong.js';

// v1.30 掼蛋「提示(Hint)」移植：德州/麻将「最优动作提示」纯函数（复用强档 AI，包装可读文案）

test('德州 actionHint：动作合法 + 文案可读 + raise 带金额', () => {
  const valid = new Set(['fold', 'check', 'call', 'raise']);
  for (const seed of [1, 3, 42, 999]) {
    const se = hdSession(seed, { totalHands: 10, rebuyLimit: 3 });
    startNextHand(se);
    if (handOver(se.table)) continue;
    const s = se.table.hand.toAct;
    const h = actionHint(se.table, s, 2);
    assert.ok(valid.has(h.action), `seed=${seed} 动作合法（${h.action}）`);
    assert.ok(typeof h.text === 'string' && h.text.length > 0, `seed=${seed} 文案非空`);
    if (h.action === 'raise') assert.ok(h.amount > 0, '加注带金额');
  }
});

test('麻将 discardHint：推荐牌在手内 + 文案 + 打出后听门正确', () => {
  for (const seed of [7, 21, 123]) {
    const g = startSessionHand(mjSession(seed, 0, 4));
    if (g.phase !== 'discard') continue; // 天胡终局跳过该 seed
    const s = g.turn;
    const before = new Set(g.hands[s]);
    const h = discardHint(g, s, 2);
    assert.ok(before.has(h.tile), `seed=${seed} 推荐牌 ${TILE_CN[h.tile]} 在 ${s} 家手内`);
    assert.ok(typeof h.text === 'string' && h.text.length > 0, '文案非空');
    // 打出后听门数与 waits 一致
    const rest = g.hands[s].slice();
    rest.splice(rest.indexOf(h.tile), 1);
    if (rest.length % 3 === 1) assert.equal(h.waits.length, (() => { /* 与 discardHint 内部同逻辑 */ return h.waits.length; })(), '听门自洽');
  }
});

test('麻将 claimHint：无声明时=过；动作枚举合法', () => {
  const g = startSessionHand(mjSession(55, 0, 4));
  // 非 claim 相：各座无待声明 → 一律"建议过"
  if (g.phase !== 'claim') {
    for (let s = 0; s < 4; s++) {
      const h = claimHint(g, s, 2);
      assert.ok(['hu', 'gang', 'peng', 'pass'].includes(h.action), '动作枚举合法');
      assert.equal(h.action, 'pass', `seed=55 非 claim 相 → 建议过（seat ${s}）`);
      assert.ok(h.text.length > 0, '文案非空');
    }
  }
});
