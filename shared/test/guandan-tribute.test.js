import { test } from 'node:test';
import assert from 'node:assert';
import { pickTribute, pickReturn, canResist, tributePairs, isDoubleDown, powerOf } from '../src/cards/guandan/tribute.js';
import { applyTribute } from '../src/cards/guandan/engine.js';

const c = (s, v, id) => ({ s, v, id: id ?? Math.random() });

test('进贡牌 = 手中除逢人配外最大的一张', () => {
  const hand = [c('S', 2), c('H', 9), c('S', 14), c('H', 5), c('S', 13)]; // H5=逢人配
  const t = pickTribute(hand, 5);
  assert.equal(t.v, 14); // 出 A（H5 是 wild 被排除；级牌 S5 不在手中）
  const hand2 = [c('S', 2), c('S', 5)]; // S5=级牌（非红桃，不是 wild）
  assert.equal(pickTribute(hand2, 5).v, 5); // 级牌可进贡
  const hand3 = [c('J', 'B'), c('S', 2)];
  assert.equal(pickTribute(hand3, 5).v, 'B'); // 大王最大，可进贡（抗贡另判）
});

test('还贡牌 = 最小的一张 ≤10；没有 ≤10 则还最小', () => {
  const hand = [c('S', 14), c('H', 8), c('S', 11)];
  assert.equal(pickReturn(hand, 5).v, 8);
  const hand2 = [c('S', 14), c('H', 13)]; // 全 >10
  assert.equal(pickReturn(hand2, 5).v, 13); // 宽松：还最小
});

test('双下判定：头游二游同队', () => {
  assert.ok(isDoubleDown([0, 2, 1, 3]));  // 头游0 二游2 同队
  assert.ok(isDoubleDown([3, 1, 2, 0]));  // 头游3 二游1 同队
  assert.ok(!isDoubleDown([0, 1, 2, 3])); // 头游0 二游1 不同队
});

test('抗贡（官方）：非双下仅末游持 2 大王；双下两家合计 2 大王', () => {
  // 非双下 fo=[0,1,2,3]：仅末游 3 的手牌参与判定
  const hands1 = { 2: [c('J', 'B'), c('S', 2)], 3: [c('J', 'B'), c('J', 'B')] };
  assert.ok(canResist([0, 1, 2, 3], hands1));   // 末游持 2 大王 → 抗贡
  assert.ok(!canResist([0, 1, 2, 3], { 2: [c('J', 'B'), c('J', 'B')], 3: [c('S', 2)] })); // 三游俩不算
  // 双下 fo=[0,2,1,3]：合计判定
  const hands2 = { 1: [c('J', 'B'), c('S', 2)], 3: [c('J', 'B'), c('S', 3)] };
  assert.ok(canResist([0, 2, 1, 3], hands2));   // 各一张 → 抗贡
  assert.ok(!canResist([0, 2, 1, 3], { 1: [c('J', 'B'), c('S', 2)], 3: [c('J', 'S'), c('S', 3)] }));
});

test('进贡配对（官方）：非双下单贡；双下双贡；同大换向', () => {
  assert.deepEqual(tributePairs([0, 1, 2, 3]), [{ giver: 3, receiver: 0 }]); // 非双下仅末游→头游
  assert.deepEqual(tributePairs([0, 2, 1, 3]), [ // 双下默认：末游→头游、三游→二游
    { giver: 3, receiver: 0 }, { giver: 1, receiver: 2 }
  ]);
  assert.deepEqual(tributePairs([0, 2, 1, 3], true), [ // 同大换向：三游→头游、末游→二游
    { giver: 1, receiver: 0 }, { giver: 3, receiver: 2 }
  ]);
});

// ── 官方先出权四种情形（直接构造 m 调 applyTribute）──
function makeMatch(fo, hands, humanSeat = -1) {
  return {
    humanSeat, handLevel: 5, hands, lastFinish: fo,
    leaderSeat: fo[0], pendingReturn: null,
    tributeInfo: null, log: []
  };
}
// 非双下：头游0 二游1 三游2 末游3（0/2 队0，1/3 队1 → 头游+三游同队 ✓）
// 双下：头游0 二游2 三游1 末游3（0/2 同队、1/3 同队 ✓）

test('先出权①单贡：非双下仅末游→头游进贡，末游（下游）先出', () => {
  const hands = {
    0: Array.from({ length: 5 }, () => c('S', 6)),
    1: [c('H', 7)],
    2: [c('D', 8)],
    3: [c('S', 14), c('H', 13), c('D', 9)] // 末游最大 A → 贡 A
  };
  const m = makeMatch([0, 1, 2, 3], hands);
  applyTribute(m);
  assert.equal(m.tributeInfo.acts.length, 1, '非双下只有一条贡');
  assert.equal(m.tributeInfo.acts[0].giver, 3);
  assert.equal(m.tributeInfo.acts[0].receiver, 0);
  assert.equal(m.leaderSeat, 3, '先出权=下游者（末游）');
});

test('先出权②双贡：贡大牌者先出', () => {
  const hands = {
    0: [c('S', 6), c('H', 6)],
    2: [c('D', 7)],
    1: [c('S', 13), c('H', 12)], // 三游贡 K
    3: [c('S', 14), c('H', 10)]  // 末游贡 A（大）
  };
  const m = makeMatch([0, 2, 1, 3], hands);
  applyTribute(m);
  assert.equal(m.tributeInfo.acts.length, 2);
  assert.equal(m.tributeInfo.crossed, false, '贡牌不同大不换向');
  assert.equal(m.tributeInfo.acts[0].giver, 3, '默认配对：末游→头游');
  assert.equal(m.tributeInfo.acts[1].giver, 1, '默认配对：三游→二游');
  assert.equal(m.leaderSeat, 3, '贡大牌者（末游 A）先出');
});

test('先出权③双贡同大：换向进贡，上游者（头游）下家先出', () => {
  const hands = {
    0: [c('S', 6), c('H', 6)],
    2: [c('D', 7)],
    1: [c('S', 14), c('H', 12)], // 三游贡 A
    3: [c('H', 14), c('D', 10)]  // 末游贡 A（同大，不同花）
  };
  const m = makeMatch([0, 2, 1, 3], hands);
  applyTribute(m);
  assert.equal(m.tributeInfo.crossed, true, '同大换向');
  assert.deepEqual(m.tributeInfo.acts.map(a => [a.giver, a.receiver]), [[1, 0], [3, 2]], '三游→头游、末游→二游');
  assert.equal(m.leaderSeat, 3, '头游 0 的下家（逆时针）=3');
});

test('先出权④抗贡：头游先出（非双下末游俩大王 / 双下合计俩大王）', () => {
  // 非双下：末游持 2 大王
  const m1 = makeMatch([0, 1, 2, 3], { 0: [], 1: [], 2: [c('S', 2)], 3: [c('J', 'B'), c('J', 'B'), c('S', 5)] });
  applyTribute(m1);
  assert.equal(m1.tributeInfo.resisted, true);
  assert.equal(m1.leaderSeat, 0, '上游者（头游）先出');
  // 双下：三游+末游各持 1 大王
  const m2 = makeMatch([0, 2, 1, 3], { 0: [], 2: [], 1: [c('J', 'B'), c('S', 5)], 3: [c('J', 'B'), c('S', 6)] });
  applyTribute(m2);
  assert.equal(m2.tributeInfo.resisted, true);
  assert.equal(m2.leaderSeat, 0, '上游者（头游）先出');
});

test('贡牌力量值：大王 > 小王 > 级牌 > A', () => {
  const w = 10;
  assert.ok(powerOf(c('J', 'B'), w) > powerOf(c('J', 'S'), w));
  assert.ok(powerOf(c('J', 'S'), w) > powerOf(c('S', 10), w)); // 级牌
  assert.ok(powerOf(c('S', 10), w) > powerOf(c('S', 14), w));
});
