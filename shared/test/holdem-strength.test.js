import { test } from 'node:test';
import assert from 'node:assert';
import { handStrength } from '../src/cards/holdem.js';

// v1.35 德州 手牌牌力提示（对齐掼蛋牌型识别/报牌）：handStrength 的牌型/强度档判定

const C = (v, s) => ({ v, s });
function fakeTable(hole0, board) {
  return { hand: { hole: [[...hole0], [], [], []], board, results: null } };
}

test('handStrength：翻牌前不足 5 张 → ready=false', () => {
  assert.equal(handStrength(fakeTable([C(14, 'S'), C(13, 'S')], []), 0).ready, false, 'preflop 2 张无公共牌');
  assert.equal(handStrength(null, 0).ready, false, '无 table');
});

test('handStrength：皇家同花顺 → rank9 坚果', () => {
  const t = fakeTable([C(14, 'S'), C(13, 'S')], [C(12, 'S'), C(11, 'S'), C(10, 'S'), C(9, 'S'), C(8, 'S')]);
  const s = handStrength(t, 0);
  assert.equal(s.ready, true);
  assert.equal(s.rank, 9, '皇家同花顺 rank=9');
  assert.equal(s.hand, '皇家同花顺');
  assert.equal(s.tier, 'nuts');
  assert.match(s.text, /皇家同花顺/);
});

test('handStrength：高牌（无对无顺无花）→ rank0 弱', () => {
  const t = fakeTable([C(2, 'S'), C(5, 'D')], [C(7, 'C'), C(9, 'H'), C(11, 'S'), C(13, 'D'), C(4, 'C')]);
  const s = handStrength(t, 0);
  assert.equal(s.rank, 0, '高牌 rank=0');
  assert.equal(s.hand, '高牌');
  assert.equal(s.tier, 'veryweak');
});

test('handStrength：一对 → rank1 偏弱', () => {
  const t = fakeTable([C(8, 'S'), C(8, 'D')], [C(2, 'C'), C(5, 'H'), C(9, 'S'), C(13, 'D'), C(12, 'C')]);
  const s = handStrength(t, 0);
  assert.equal(s.rank, 1, '一对 rank=1');
  assert.equal(s.hand, '一对');
  assert.equal(s.tier, 'weak');
});
