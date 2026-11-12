import { test } from 'node:test';
import assert from 'node:assert';
import {
  createMatch, startHand, play, pass, computeUpgrade,
  partnerOf, teamOf, activeSeats, serialize, restore,
  completeReturn, validReturn
} from '../src/cards/guandan/engine.js';
import { choose } from '../src/cards/guandan/ai.js';
import { recognize } from '../src/cards/guandan/combos.js';

function totalCards(m) {
  return m.hands.reduce((n, h) => n + h.length, 0);
}

test('发牌：4×27=108，id 唯一', () => {
  const m = createMatch(42);
  assert.equal(m.hands.length, 4);
  m.hands.forEach(h => assert.equal(h.length, 27));
  assert.equal(totalCards(m), 108);
  assert.equal(new Set(m.hands.flat().map(c => c.id)).size, 108);
  assert.equal(m.phase, 'play');
  assert.ok(m.turnSeat >= 0 && m.turnSeat <= 3);
});

test('同 seed 确定性：两次发牌一致', () => {
  const a = createMatch(7), b = createMatch(7);
  assert.deepEqual(a.hands.flat().map(c => c.id), b.hands.flat().map(c => c.id));
  assert.equal(a.firstLeader, b.firstLeader);
});

test('非法动作被拒绝：非当前座位 / 领出时过牌 / 非法牌型', () => {
  const m = createMatch(99);
  const t = m.turnSeat;
  assert.equal(play(m, (t + 1) % 4, m.hands[t].slice(0, 1)).ok, false); // 非当前座位
  assert.equal(pass(m, t).reason, 'must-lead');                          // 首出不可过
  assert.equal(play(m, t, m.hands[t].slice(0, 2)).ok, false);           // 两张不同点非牌型
  // 合法首出（单张）
  const r = play(m, t, m.hands[t].slice(0, 1));
  assert.equal(r.ok, true);
});

test('computeUpgrade：双下+3 / 1-3游+2 / 1-4游+1，封顶 A；过A 需打A局且对家非末游', () => {
  // 座位 0/1/2/3，队0={0,2} 队1={1,3}
  let u = computeUpgrade([0, 2, 1, 3], [2, 2], 2, 0); // 头游0 对家2=二游 → 队0 +3
  assert.equal(u.wTeam, 0); assert.equal(u.adv, 3); assert.deepEqual(u.newLevels, [5, 2]);
  assert.equal(u.passA, false); // 没在打 A
  u = computeUpgrade([0, 1, 2, 3], [2, 2], 2, 0);      // 对家2=三游 → +2
  assert.equal(u.adv, 2); assert.deepEqual(u.newLevels, [4, 2]);
  u = computeUpgrade([0, 1, 3, 2], [2, 2], 2, 0);      // 对家2=末游 → +1
  assert.equal(u.adv, 1); assert.deepEqual(u.newLevels, [3, 2]);
  u = computeUpgrade([1, 3, 0, 2], [2, 13], 5, 1);      // 队1 +3 封顶 14
  assert.deepEqual(u.newLevels, [2, 14]);
  assert.equal(u.passA, false); // 局牌 5 不是 A
  u = computeUpgrade([0, 2, 1, 3], [14, 2], 14, 0);    // 打A局 双下 → 过A
  assert.equal(u.passA, true);
  u = computeUpgrade([0, 1, 3, 2], [14, 2], 14, 0);    // 打A局 对家末游 → 不过A
  assert.equal(u.passA, false);
});

test('AI-vs-AI 整场模拟：合法、守恒、可打完（多个 seed）', () => {
  for (const seed of [1, 2, 3, 42, 12345]) {
    const m = createMatch(seed);
    let guard = 0;
    while (!m.matchOver && guard++ < 300000) {
      if (m.phase === 'handEnd') {
        // 末游（最后一家）可能仍持牌；其余三家已清
        assert.ok(totalCards(m) <= 27, '手牌总数 ≤ 末游 27 张');
        startHand(m);
        assert.equal(totalCards(m), 108, '新副牌 108 张');
      }
      if (m.phase === 'tribute' && m.humanSeat >= 0) {
        // 纯 AI 模拟遇到人类还贡点时自动补还（humanSeat=-1 不会进此分支）
        const card = m.hands[m.humanSeat].find(c => validReturn(m, c));
        assert.ok(card, '应存在一张合法还贡牌');
        assert.equal(completeReturn(m, card).ok, true, '自动补还贡');
      }
      assert.equal(m.phase, 'play');
      const seat = m.turnSeat;
      const d = choose(m, seat);
      let r;
      if (d.pass) {
        r = pass(m, seat);
      } else {
        assert.ok(d.cards.every(c => m.hands[seat].some(h => h.id === c.id)), 'AI 出牌必须来自手牌');
        assert.equal(new Set(d.cards.map(c => c.id)).size, d.cards.length, 'AI 不得重复用同一张牌');
        r = play(m, seat, d.cards);
      }
      assert.equal(r.ok, true, `seed=${seed} 第${m.handNo}副 AI(${seat}) 出牌/过牌合法`);
      // 牌守恒
      assert.ok(totalCards(m) <= 108);
      assert.ok(m.teamLevels.every(l => l >= 2 && l <= 14));
    }
    assert.ok(m.matchOver, `seed=${seed} 应在 ${guard} 步内打完整场`);
    assert.ok(m.winnerTeam === 0 || m.winnerTeam === 1);
    assert.equal(m.handLevel, 14, '整场以打 A 局收尾');
    assert.ok(m.lastAdv >= 2, '胜方过 A 需 +2/+3');
    console.log(`  seed=${seed} 整场 ${m.totalHands} 副牌, 胜方队${m.winnerTeam} (${guard} 步)`);
  }
});

test('手动还贡（humanSeat=0）：非法拒绝 + 合法完成 + 整场仍有还贡发生', () => {
  let totalReturns = 0;
  for (const seed of [7, 8, 9]) {
    const m = createMatch(seed, 0);
    let guard = 0;
    let returns = 0;
    while (!m.matchOver && guard++ < 300000) {
      if (m.phase === 'handEnd') startHand(m);
      if (m.phase === 'tribute') {
        const hand = m.hands[0];
        const legal = hand.filter(c => validReturn(m, c));
        assert.ok(legal.length > 0, '必存在一张合法还贡牌');
        // 非法牌（王/逢人配/超10）必须被拒
        const bad = hand.find(c => !validReturn(m, c));
        if (bad) assert.equal(completeReturn(m, bad).ok, false, '非法还贡被拒');
        const before = totalCards(m);
        assert.equal(completeReturn(m, legal[0]).ok, true, '合法还贡完成');
        assert.equal(Math.abs(totalCards(m) - before), 0, '还贡后总牌数守恒');
        assert.equal(m.phase, 'play');
        returns++;
      }
      if (m.phase === 'play') {
        const seat = m.turnSeat;
        const d = choose(m, seat);
        if (d.pass) pass(m, seat); else play(m, seat, d.cards);
      }
    }
    assert.ok(m.matchOver, `seed=${seed} 整场打完`);
    totalReturns += returns;
    console.log(`  seed=${seed} 整场 ${m.totalHands} 副, 人类手动还贡 ${returns} 次`);
  }
  assert.ok(totalReturns > 0, '多 seed 下人类（收贡方）必然至少发生一次手动还贡');
});

test('AI 会用 4 张炸弹（跟对子/单张时出炸抢牌权，不会死捂）', () => {
  let b4Played = 0, anyBomb = 0;
  for (const seed of [1, 3, 42]) {
    const m = createMatch(seed);
    let guard = 0;
    while (!m.matchOver && guard++ < 300000) {
      if (m.phase === 'handEnd') startHand(m);
      if (m.phase === 'tribute' && m.humanSeat >= 0) {
        const c = m.hands[m.humanSeat].find(x => validReturn(m, x));
        if (c) completeReturn(m, c);
        continue;
      }
      const seat = m.turnSeat;
      const d = choose(m, seat);
      if (d.pass) { pass(m, seat); continue; }
      const r = play(m, seat, d.cards);
      if (!r.ok) throw new Error(`seed=${seed} 出牌非法 ${r.reason}`);
      if (r.combo && r.combo.power >= 2) { anyBomb++; if (r.combo.power === 2) b4Played++; }
    }
  }
  assert.ok(anyBomb > 0, '整场中 AI 至少打出过炸弹');
  assert.ok(b4Played > 0, '整场中 AI 至少打出过 4 张炸弹（power=2）');
  console.log(`  3 seed 共 ${anyBomb} 次炸弹, 其中 ${b4Played} 次 4 炸`);
});

test('serialize/restore：存档恢复后整场仍可打完', () => {
  const m = createMatch(2026);
  // 打 3 副后存档
  for (let i = 0; i < 3; i++) {
    while (m.phase === 'play') {
      const d = choose(m, m.turnSeat);
      d.pass ? pass(m, m.turnSeat) : play(m, m.turnSeat, d.cards);
    }
    assert.equal(m.phase, 'handEnd');
    startHand(m);
  }
  const snap = serialize(m);
  const m2 = restore(snap);
  assert.deepEqual(m2.teamLevels, m.teamLevels);
  assert.equal(m2.handNo, m.handNo);
  let guard = 0;
  while (!m2.matchOver && guard++ < 300000) {
    if (m2.phase === 'handEnd') { startHand(m2); continue; }
    const d = choose(m2, m2.turnSeat);
    d.pass ? pass(m2, m2.turnSeat) : play(m2, m2.turnSeat, d.cards);
  }
  assert.ok(m2.matchOver, '恢复后仍可打完');
});

test('进贡/还贡：第 2 副起必有 tributeInfo，且进贡后总牌数不变', () => {
  const m = createMatch(31415);
  for (let i = 0; i < 2 && !m.matchOver; i++) {
    while (m.phase === 'play') {
      const d = choose(m, m.turnSeat);
      d.pass ? pass(m, m.turnSeat) : play(m, m.turnSeat, d.cards);
    }
    if (m.matchOver) break;
    startHand(m);
  }
  if (m.handNo >= 2) {
    assert.ok(m.tributeInfo, '第 2 副起必有进贡/抗贡信息');
    if (!m.tributeInfo.resisted) {
      for (const a of m.tributeInfo.acts) {
        assert.ok(a.tribute, '有贡牌');
        assert.equal(m.hands[a.giver].length + m.hands[a.receiver].length, 54, '一进一还后两队各 27');
      }
    }
  }
});

test('官方接风：牌主最后一手全过 → 出牌权归牌主的对家', () => {
  const m = createMatch(7);
  m.phase = 'play';
  // 手工构造：seat0 刚打出最后一手（已进 finishedOrder），场上剩 1/2/3 应牌
  m.hands[0] = [];
  m.finishedOrder = [0];
  m.trickOwner = 0;
  m.leaderCombo = { type: 'single', main: 8, power: 0, cards: [] };
  m.passed = [];
  m.turnSeat = 3; // 逆时针 0→3→2→1，advance(0)=3
  pass(m, 3); pass(m, 2); pass(m, 1); // 其他玩家全部放弃
  assert.equal(m.trickOwner, 2, '接风：对家（seat2）获得出牌权');
  assert.equal(m.turnSeat, 2);
  assert.equal(m.leaderCombo, null, '接风后自由出牌');
});
