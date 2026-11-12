import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, autoPlayHand, handLog } from '../src/cards/mahjong.js';

// v1.39 麻将 本局关键事件流（对齐掼蛋 playlog / 德州下注日志）：g.events + handLog 的不变量
const ALLOW = new Set(['碰', '明杠', '暗杠', '加杠', '自摸', '杠上花', '点炮', '流局']);
const TERM = ['自摸', '杠上花', '点炮', '流局'];

test('handLog: 无 g / 无 events → []', () => {
  assert.deepEqual(handLog(null), []);
  assert.deepEqual(handLog({}), []);
});

test('handLog: 每局恰好一个终止事件（自摸/点炮/流局）且位于末尾；所有 k 在白名单', () => {
  for (const seed of [1, 7, 42, 313, 2026, 888, 5, 64, 313, 1234]) {
    const g = createGame(seed, 0);
    autoPlayHand(g, 1);
    const ev = handLog(g);
    for (const e of ev) assert.ok(ALLOW.has(e.k), `seed=${seed} 非法事件 k=${e.k}`);
    const termCount = ev.filter(e => TERM.includes(e.k)).length;
    assert.equal(termCount, 1, `seed=${seed} 应恰好一个终止事件`);
    assert.ok(TERM.includes(ev[ev.length - 1].k), `seed=${seed} 终止事件须在末尾`);
  }
});

test('handLog: 确定性——同 seed 同打法 → 事件流完全一致（可重放）', () => {
  const a = autoPlayHand(createGame(1234, 0), 1);
  const b = autoPlayHand(createGame(1234, 0), 1);
  assert.deepEqual(handLog(a), handLog(b));
});

test('handLog: 事件座/牌面合法（seat 0-3；tile 0-33；点炮 by≠赢家 且合法）', () => {
  for (const seed of [2, 20, 31, 999, 4242]) {
    const g = createGame(seed, 0);
    autoPlayHand(g, 1);
    for (const e of handLog(g)) {
      if (e.k !== '流局') assert.ok(e.s >= 0 && e.s <= 3, `seed=${seed} seat=${e.s}`);
      if (e.tile != null) assert.ok(e.tile >= 0 && e.tile <= 33, `seed=${seed} tile=${e.tile}`);
      if (e.k === '点炮') assert.ok(e.by >= 0 && e.by <= 3 && e.by !== e.s, `seed=${seed} 点炮 by 合法且≠赢家`);
    }
  }
});
