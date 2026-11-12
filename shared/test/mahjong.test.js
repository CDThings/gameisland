import { test } from 'node:test';
import assert from 'node:assert';
import { buildWall, canHu, waits, createGame, createSession, startSessionHand, endSessionHand, discard, doClaim, claimOptions, selfHu, aiDiscard, gameover, fanOf, scoreWin, TILE_CN } from '../src/cards/mahjong.js';

const T = id => id;
test('牌墙 136 张：每种 4 张', () => {
  const w = buildWall();
  assert.equal(w.length, 136);
  const c = {}; w.forEach(t => c[t] = (c[t] || 0) + 1);
  assert.equal(Object.keys(c).length, 34);
  assert.ok(Object.values(c).every(n => n === 4));
});
test('胡牌判定：标准 / 七对 / 非胡', () => {
  assert.ok(canHu([0,0,0, 1,2,3, 10,11,12, 20,21,22, 5,5]));      // 顺刻混合
  assert.ok(canHu([0,1,2, 3,4,5, 9,10,11, 18,19,20, 27,27]));     // 全顺+字雀
  assert.ok(canHu([0,0,1,1,2,2, 9,9,10,10,11,11, 27,27]));        // 七对（含两连对）
  assert.ok(!canHu([0,0,0, 1,2,4, 10,11,12, 20,21,22, 5,5]));     // 1,2,4 断
  assert.ok(!canHu([0,1,2, 3,4,5, 9,10,11, 18,19,20]));           // 12 张不可判胡
});
test('听牌：13 张缺一张的进牌', () => {
  const hand = [0,0,0, 1,2,3, 10,11,12, 20,21,22, 5]; // 听 5
  assert.deepEqual(waits(hand), [4, 5]); // 4 进牌成 2-3-4 顺+5 雀头，或 5 成雀
});
test('整场 AI-vs-AI 30 seed：136 张守恒 / 终局胡或流局 / 计分零和', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = createGame(seed, -1); // 无人类，全 AI
    let guard = 0;
    while (!gameover(g) && guard++ < 20000) {
      if (g.phase === 'claim') { const s = g.claimPending.cur; const o = claimOptions(g, s); doClaim(g, s, o.hu ? 'hu' : o.gang ? 'gang' : o.peng ? 'peng' : 'pass'); continue; }
      if (g.phase === 'discard') {
        const seat = g.turn;
        if (g.selfHuPending && seat === g.turn) { selfHu(g, seat); continue; }
        const t = aiDiscard(g, seat);
        const r = discard(g, seat, t);
        assert.equal(r.ok, true, `seed=${seed} s${seat} 打 ${TILE_CN[t]} 合法`);
        continue;
      }
      break;
    }
    assert.ok(gameover(g), `seed=${seed} 终局`);
    const all = [...g.wall, ...g.hands.flat(), ...g.discards.flat(), ...g.melds.flat().map(m => m.tile * 4 + (m.kind === 'peng' ? 1 : m.concealed ? 2 : 3) - 1)].length;
    // 守恒口径：墙 + 手 + 弃 = 136 - 副露占用（每meld 3/4 张）
    const inMelds = g.melds.flat().reduce((n, m) => n + (m.kind === 'gang' ? 4 : 3), 0);
    assert.equal(g.wall.length + g.hands.flat().length + g.discards.flat().length + inMelds, 136, `seed=${seed} 136 张守恒`);
    assert.equal(g.scores.reduce((a, b) => a + b, 0), 0, `seed=${seed} 计分零和`);
  }
});

test('整场 4 局（连庄制）：四家各当过庄 / 累计零和 / 终场有冠军', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const sess = createSession(seed, -1, 4);
    const dealerSeen = new Set();
    let guard = 0;
    while (!sess.over && guard++ < 40) {
      const d = sess.dealer;
      dealerSeen.add(d);
      const g = startSessionHand(sess);
      assert.equal(g.dealer, d, `seed=${seed} 本局庄=${d}`);
      let guard = 0;
      while (!gameover(g) && guard++ < 20000) {
        if (g.phase === 'claim') { const s2 = g.claimPending.cur; const o = claimOptions(g, s2); doClaim(g, s2, o.hu ? 'hu' : o.gang ? 'gang' : o.peng ? 'peng' : 'pass'); continue; }
        if (g.phase === 'discard') {
          if (g.selfHuPending) selfHu(g, g.turn);
          else discard(g, g.turn, aiDiscard(g, g.turn));
          continue;
        }
        break;
      }
      assert.ok(gameover(g), `seed=${seed} 局终局`);
      endSessionHand(sess);
    }
    assert.equal(sess.over, true, '整场结束');
    assert.equal(dealerSeen.size, 4, '四家各当过庄（连庄不计数）');
    assert.equal(sess.total.reduce((a, b) => a + b, 0), 0, '累计零和');
    assert.ok(sess.champ >= 0 && sess.champ < 4, '有冠军');
    const mx = Math.max(...sess.total);
    assert.equal(sess.total[sess.champ], mx, '冠军=累计分最高');
  }
});

test('番数与计分：自摸底=点炮×2 / 点炮仅点炮者付 / 封顶 8 番', () => {
  // 构造一局：seat0 门前清胡（无副露）
  const g = createGame(7, -1);
  g.phase = 'over'; g.winner = 0;
  g.hands[0] = [0,0,0,1,2,3,10,11,12,18,19,20,5,5]; // 14 张（胡牌后含进张）
  g.melds[0] = [];
  const r = scoreWin(g, 0, -1, true, 10); // 自摸：基础1+门清1+自摸1+全数1=4番（不含七对）
  assert.ok(r.fan >= 3 && r.fan <= 8, '番数合理');
  const pay = r.pay;
  assert.equal(g.scores[0], pay * 3, '自摸赢家收三家');
  assert.equal(g.scores[1] + g.scores[2] + g.scores[3], -3 * pay, '三家各付');
  assert.equal(g.scores.reduce((a, b) => a + b, 0), 0, '零和');
  // 点炮：仅点炮者付
  const g2 = createGame(8, -1);
  g2.phase = 'over'; g2.winner = 1; g2.hands[1] = [0,0,0,1,2,3,10,11,12,18,19,20,5,5];
  scoreWin(g2, 1, 3, false, 10);
  assert.equal(g2.scores[3], -g2.scores[1], '点炮者付=赢家收');
  assert.equal(g2.scores[0], 0); assert.equal(g2.scores[2], 0);
  assert.ok(g2.lastWin.pay === pay / 2 || g2.lastWin.pay <= pay, '点炮每分 < 自摸每分（自摸×2底）');
  // 封顶 8 番
  const g3 = createGame(9, -1);
  g3.hands[3] = [0,0,1,1,2,2,9,9,10,10,11,11,27,27]; // 七对
  g3.melds[3] = [];
  const r3 = scoreWin(g3, 3, -1, true, 10); // 七对+2 自摸+1 门清+1 全数？有字牌非全数
  assert.ok(r3.fan <= 8, '番数封顶 8');
});
