import { test } from 'node:test';
import assert from 'node:assert';
import { buildDeck, evaluate5, evaluate7, cmpEval, evalText, splitPots, createTable, startHand, act, legalActions, aiDecide, handOver, createSession, startNextHand } from '../src/cards/holdem.js';

const C = (s, v) => ({ s, v });
test('牌型评估：皇家 > 同花顺 > 四条 > 葫芦 > 同花 > 顺 > 三条 > 两对 > 一对 > 高牌', () => {
  const rf = evaluate5([C('S',10), C('S',11), C('S',12), C('S',13), C('S',14)]);
  const sf = evaluate5([C('H',5), C('H',6), C('H',7), C('H',8), C('H',9)]);
  const quad = evaluate5([C('S',9), C('H',9), C('D',9), C('C',9), C('S',2)]);
  const boat = evaluate5([C('S',9), C('H',9), C('D',9), C('C',2), C('S',2)]);
  const fl = evaluate5([C('S',2), C('S',5), C('S',9), C('S',11), C('S',13)]);
  const st = evaluate5([C('S',5), C('H',6), C('D',7), C('C',8), C('S',9)]);
  const tri = evaluate5([C('S',7), C('H',7), C('D',7), C('C',2), C('S',3)]);
  const two = evaluate5([C('S',7), C('H',7), C('D',3), C('C',3), C('S',9)]);
  const one = evaluate5([C('S',7), C('H',7), C('D',10), C('C',2), C('S',3)]);
  const hi = evaluate5([C('S',2), C('H',7), C('D',9), C('C',11), C('S',13)]);
  assert.equal(rf.rank, 9); assert.equal(sf.rank, 8); assert.equal(quad.rank, 7);
  assert.equal(boat.rank, 6); assert.equal(fl.rank, 5); assert.equal(st.rank, 4);
  assert.equal(tri.rank, 3); assert.equal(two.rank, 2); assert.equal(one.rank, 1); assert.equal(hi.rank, 0);
  let prev = null;
  for (const ev of [hi, one, two, tri, st, fl, boat, quad, sf, rf]) {
    if (prev) assert.ok(cmpEval(ev, prev) > 0, evalText(ev) + ' > ' + evalText(prev));
    prev = ev;
  }
});
test('A2345 是最小顺（输给 23456）；同花顺 > 4条', () => {
  const wheel = evaluate5([C('S',14), C('H',2), C('D',3), C('C',4), C('S',5)]);
  const five = evaluate5([C('S',2), C('H',3), C('D',4), C('C',5), C('S',6)]);
  assert.equal(wheel.rank, 4); assert.equal(wheel.tb[0], 5);
  assert.ok(cmpEval(five, wheel) > 0);
});
test('evaluate7 用 7 张选最优 5 张', () => {
  const ev = evaluate7([C('S',10), C('S',11), C('S',12), C('S',13), C('S',14), C('H',2), C('D',3)]);
  assert.equal(ev.rank, 9);
});
test('边池分层：投入 [300,300,100,50] → 三层池', () => {
  const pots = splitPots([300, 300, 100, 50]);
  assert.equal(pots.length, 3);
  assert.equal(pots[0].amount, 200); assert.deepEqual(pots[0].eligible, [0,1,2,3]);
  assert.equal(pots[1].amount, 150); assert.deepEqual(pots[1].eligible, [0,1,2]);
  assert.equal(pots[2].amount, 400); assert.deepEqual(pots[2].eligible, [0,1]);
  assert.equal(pots.reduce((n, p) => n + p.amount, 0), 750, '池总额=总投入');
});
test('整场 20 seed：筹码守恒 / 合法动作 / 有人胜出或平局', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = createTable(seed);
    let hands = 0;
    while (!t.matchOver && hands++ < 2000) {
      startHand(t);
      if (t.matchOver) break;
      assert.equal(t.stacks.reduce((a, b) => a + b, 0) + t.hand.committed.reduce((a, b) => a + b, 0), 2000, `seed=${seed} h${t.handNo} 筹码守恒`);
      let guard = 0;
      while (!handOver(t) && guard++ < 10000) {
        const seat = t.hand.toAct;
        const d = seat === 0 ? { action: legalActions(t, 0).canCheck ? 'check' : 'call' } : aiDecide(t, seat);
        const r = act(t, seat, d.action, d.amount);
        assert.equal(r.ok, true, `seed=${seed} h${t.handNo} s${seat} ${d.action} 合法`);
      }
      assert.ok(handOver(t), '一手内结束');
      assert.equal(t.stacks.reduce((a, b) => a + b, 0), 2000, `seed=${seed} h${t.handNo} 结算后筹码守恒`);
      assert.ok(t.hand.results);
    }
    assert.ok(t.matchOver, `seed=${seed} 最终有人清场或只余一人`);
  }
});

test('session：10 手定场 + rebuy 上限 + 筹码零和 + 冠军', () => {
  for (let seed = 3; seed <= 5; seed++) {
    const sess = createSession(seed, { totalHands: 10, rebuyLimit: 3 });
    let hands = 0;
    while (!sess.over && hands++ < 60) {
      startNextHand(sess);
      const t = sess.table;
      let g = 0;
      while (!handOver(t) && g++ < 1000) {
        const s = t.hand.toAct;
        const d = s === 0 ? { action: legalActions(t, 0).canCall ? 'call' : 'check' } : aiDecide(t, s);
        const r = act(t, s, d.action, d.amount);
        assert.equal(r.ok, true, `seed=${seed} h${t.handNo} s${s} ${d.action} 合法`);
      }
      assert.equal(t.stacks.reduce((a, b) => a + b, 0), 4000, `seed=${seed} h${t.handNo} 手终 4000 守恒`);
    }
    assert.ok(sess.over, '整场结束');
    assert.ok(sess.champ >= 0 && sess.champ < 4, '有冠军');
    assert.equal(sess.table.stacks[sess.champ], Math.max(...sess.table.stacks), '冠军=筹码最高');
    assert.ok(sess.rebuys.every(n => n <= 3), 'rebuy 不超上限');
  }
});
