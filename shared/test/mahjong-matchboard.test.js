import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startSessionHand, autoPlayHand, endSessionHand, autoPlayMatch, matchBoard
} from '../src/cards/mahjong.js';

// v1.39 麻将 整场态势（对齐牛牛记分牌 / 德州态势）：matchBoard 的不变量

test('matchBoard: 无 sess / total 非数组 → null', () => {
  assert.equal(matchBoard(null), null);
  assert.equal(matchBoard({ total: 'nope' }), null);
});

test('matchBoard: 初始 leader=0（总分全 0 取最小座位）· spread=0 · progress=0 · 未过', () => {
  const s = createSession(123, 0, 4);
  const b = matchBoard(s);
  assert.equal(b.leader, 0);
  assert.equal(b.spread, 0);
  assert.equal(b.handNo, 0);
  assert.equal(b.hands, 4);
  assert.equal(b.progress, 0);
  assert.equal(b.over, false);
  assert.equal(b.champ, -1);
  assert.equal(b.games, 0);
  assert.deepEqual(b.totals, [0, 0, 0, 0]);
});

test('matchBoard: 整场打完 leader=champ（同 tiebreak）· progress=1 · spread=max-min', () => {
  for (const seed of [7, 99, 2026, 555]) {
    const s = createSession(seed, 0, 4);
    autoPlayMatch(s, 1);
    assert.equal(s.over, true);
    const b = matchBoard(s);
    assert.equal(b.over, true);
    assert.equal(b.progress, 1);
    assert.equal(b.games, s.games.length);
    assert.equal(b.leader, s.champ, `seed=${seed} 领先者与冠军一致（累计分→赢局→座位 同 tiebreak）`);
    assert.equal(b.spread, Math.max(...b.totals) - Math.min(...b.totals));
  }
});

test('matchBoard: 中途快照 progress∈[0,1] · leader 必是某 max(total) 座', () => {
  const s = createSession(42, 0, 4);
  const g = startSessionHand(s);
  autoPlayHand(g, 1);
  endSessionHand(s);
  const b = matchBoard(s);
  assert.ok(b.progress >= 0 && b.progress <= 1);
  assert.equal(b.progress, Math.min(1, b.handNo / b.hands));
  assert.equal(b.totals[b.leader], Math.max(...b.totals), '领先者=累计分最高座');
});
