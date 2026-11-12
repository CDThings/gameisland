import { test } from 'node:test';
import assert from 'node:assert';
import { createMatch, startHand, play, pass, completeReturn, validReturn } from '../src/cards/guandan/engine.js';
import { choose } from '../src/cards/guandan/ai.js';
import { recognize } from '../src/cards/guandan/combos.js';

/** 张数与牌型必须一致（防"出 3 张却当对子"之类的错位）。 */
const EXPECT_N = { single: 1, pair: 2, triple: 3, triple_pair: 5, straight: 5, runpairs: 6, steelplate: 6, straight_flush: 5, skybomb: 4 };
function assertShape(combo, cards, tag) {
  if (combo.type === 'bomb') assert.equal(cards.length, combo.count, `${tag} 炸弹张数`);
  else assert.equal(cards.length, EXPECT_N[combo.type], `${tag} ${combo.type} 张数`);
}

test('AI 专项：20 seed 整场——牌数守恒 / 出牌张数=牌型 / 名次完整 / 级数健全', () => {
  for (const seed of [1,2,3,4,5,6,7,8,9,10,11,12,42,99,123,777,2026,31415,65535,999999]) {
    const m = createMatch(seed);
    let guard = 0;
    while (!m.matchOver && guard++ < 300000) {
      if (m.phase === 'handEnd') {
        // 名次完整：4 个不同座位
        assert.equal(new Set(m.lastFinish).size, 4, 'finishOrder 四座完整');
        startHand(m);
        assert.equal(m.hands.reduce((n,h)=>n+h.length,0), 108, '新副 108 张');
        m.hands.forEach(h => assert.equal(h.length, 27, '每人 27 张（贡还后仍 27）'));
      }
      if (m.phase === 'tribute' && m.humanSeat >= 0) {
        const c = m.hands[m.humanSeat].find(x => validReturn(m, x));
        if (c) completeReturn(m, c);
        continue;
      }
      assert.equal(m.phase, 'play');
      const seat = m.turnSeat;
      const d = choose(m, seat);
      let r;
      if (d.pass) r = pass(m, seat);
      else {
        assert.equal(new Set(d.cards.map(c=>c.id)).size, d.cards.length, '无重复用牌');
        assert.ok(d.cards.every(c => m.hands[seat].some(h => h.id === c.id)), '出牌来自手牌');
        const combo = recognize(d.cards, m.handLevel);
        assert.ok(combo, 'AI 出牌可识别');
        assertShape(combo, d.cards, `seed=${seed} s${seat}`);
        r = play(m, seat, d.cards);
      }
      assert.equal(r.ok, true, `seed=${seed} 第${m.handNo}副 s${seat} 动作合法`);
      assert.ok(m.hands.reduce((n,h)=>n+h.length,0) <= 108, '总牌数 ≤108');
      assert.ok(m.teamLevels.every(l => l >= 2 && l <= 14), '级数范围');
    }
    assert.ok(m.matchOver, `seed=${seed} 打完`);
    assert.equal(m.handLevel, 14);
    assert.ok(m.lastAdv >= 2, '过A需+2/+3');
  }
});
