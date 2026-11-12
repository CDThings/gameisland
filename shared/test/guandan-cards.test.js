import { test } from 'node:test';
import assert from 'node:assert';
import { buildDeck, strength, isWild, isJoker, cardLabel, natureIdx } from '../src/cards/guandan/cards.js';

const C = (s, v) => ({ s, v });

test('牌组：108 张 = 两副 × 54（含 2 大王 2 小王）', () => {
  const d = buildDeck();
  assert.equal(d.length, 108);
  assert.equal(new Set(d.map(c => c.id)).size, 108);
  assert.equal(d.filter(c => c.s === 'J').length, 4);
  assert.equal(d.filter(c => c.s === 'J' && c.v === 'B').length, 2);
  assert.equal(d.filter(c => c.s === 'J' && c.v === 'S').length, 2);
  // 每 (花色,点值) 恰 2 张
  const key = c => c.s === 'J' ? `J${c.v}` : `${c.s}${c.v}`;
  const cnt = {};
  d.forEach(c => cnt[key(c)] = (cnt[key(c)] || 0) + 1);
  assert.equal(Object.keys(cnt).length, 52 + 2);
  assert.ok(Object.values(cnt).every(n => n === 2));
});

test('力量值：大王>小王>级牌>A>K>…>2', () => {
  assert.equal(strength(C('J', 'B'), 5), 15);
  assert.equal(strength(C('J', 'S'), 5), 14);
  assert.equal(strength(C('S', 5), 5), 13);  // 级牌=13
  assert.equal(strength(C('S', 14), 5), 12); // A
  assert.equal(strength(C('S', 13), 5), 11); // K
  assert.equal(strength(C('S', 2), 5), 0);
  // 非级数的牌按自然点
  assert.equal(strength(C('S', 7), 5), 5);
});

test('逢人配 = 红桃级牌（整副 2 张）', () => {
  const d = buildDeck();
  const w = d.filter(c => isWild(c, 7));
  assert.equal(w.length, 2);
  assert.ok(w.every(c => c.s === 'H' && c.v === 7));
});

test('自然索引（连张用）：2→0 … A→12，王→null', () => {
  assert.equal(natureIdx(2), 0);
  assert.equal(natureIdx(14), 12);
  assert.equal(natureIdx('B'), null);
});

test('cardLabel 可读', () => {
  assert.equal(cardLabel(C('J', 'B')), '大王');
  assert.equal(cardLabel(C('H', 14)), '♥A');
});
