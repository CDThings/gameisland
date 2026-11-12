import { test } from 'node:test';
import assert from 'node:assert';
import { recognize, beats, TYPE, powerOf } from '../src/cards/guandan/combos.js';

// 级牌=5（wildValue=5，逢人配=红桃5）
const W = 5;
const c = (s, v) => ({ s, v });
const WILD = c('H', 5); // 逢人配
const R = recognize.bind(null); // (cards, W)

// 取任意同点非红桃牌
const N = v => c('S', v);

test('单张/对子/三张 识别与力量', () => {
  assert.equal(R([N(2)], W).type, TYPE.SINGLE);
  assert.equal(R([N(2)], W).main, 0);
  assert.equal(R([N(14)], W).main, 12); // A
  assert.equal(R([N(5)], W).main, 13);  // 级牌
  assert.equal(R([c('J', 'S')], W).main, 14);
  assert.equal(R([c('J', 'B')], W).main, 15);
  assert.equal(R([N(7), N(7)], W).main, 5);
  assert.equal(R([c('J', 'B'), c('J', 'B')], W).main, 15); // 大王对
  assert.equal(R([c('J', 'B'), c('J', 'S')], W), null);      // 混合王非对
  assert.equal(R([N(9), N(9), N(9)], W).main, 7);
  assert.equal(R([N(3), N(4)], W), null); // 两张不同点非对
});

test('逢人配作单张=级牌(13)，双 wild 对=级牌对', () => {
  assert.equal(R([WILD], W).main, 13);
  assert.equal(R([WILD, WILD], W).main, 13);
  assert.equal(R([WILD, N(14)], W).main, 12); // wild 顶 A？不——wild 顶 5=级牌对(13) 更强
  // 上例：{红桃5, 黑桃A}：wild 顶 A 成 A 对(12) 或 成级牌? 级牌需两张 5，只有 1 张 5 → 只能 A 对(12) 或 5 单…
  // 两张牌组成"对子"：{5, A}：wild=5 顶 A → A 对 main=12；或 5 顶 5 → 但只有一张 5 实体+1 wild=两张 5=级牌对 main=13（更强）
  // 我们的识别取最强：级牌对(13)
  assert.ok(R([WILD, N(14)], W).main >= 12);
});

test('炸弹阶梯：4炸<5炸<同花顺<6炸<7炸<8炸<天王炸', () => {
  const b4 = R([N(9), N(9), N(9), N(9)], W);
  const b5 = R([N(8), N(8), N(8), N(8), N(8)], W);
  const flush = R([c('H', 10), c('H', 11), c('H', 12), c('H', 13), c('H', 14)], W);
  const b6 = R([N(7), N(7), N(7), N(7), N(7), N(7)], W);
  const b8 = R([N(6), N(6), N(6), N(6), N(6), N(6), N(6), N(6)], W);
  const sky = R([c('J', 'B'), c('J', 'B'), c('J', 'S'), c('J', 'S')], W);
  assert.equal(b4.power, 2);
  assert.equal(b5.power, 3);
  assert.equal(flush.type, TYPE.STRAIGHT_FLUSH);
  assert.equal(flush.power, 4);
  assert.equal(b6.power, 5);
  assert.equal(b8.power, 7);
  assert.equal(sky.type, TYPE.SKYBOMB);
  assert.equal(sky.power, 8);
  // 阶梯
  assert.ok(beats(b5, b4));        // 5炸 > 4炸
  assert.ok(beats(flush, b5));     // 同花顺 > 5炸
  assert.ok(!beats(flush, b6));    // 同花顺 < 6炸
  assert.ok(beats(b6, flush));
  assert.ok(beats(b8, b6));
  assert.ok(beats(sky, b8));       // 天王炸最大
  assert.ok(!beats(b4, sky));
});

test('同张数炸弹比主点；级牌炸 > A 炸', () => {
  const b4a = R([N(14), N(14), N(14), N(14)], W); // 4 张 A
  const b4lv = R([N(5), N(5), N(5), N(5)], W);     // 4 张级牌(5)
  assert.ok(beats(b4lv, b4a));       // 级牌炸 > A 炸（级牌=13>A=12）
  assert.ok(!beats(b4a, b4lv));
  const b4k = R([N(13), N(13), N(13), N(13)], W);  // 4 张 K
  assert.ok(beats(b4a, b4k));        // A 炸 > K 炸
});

test('顺子：A2345 合法（A 最小）、10JQKA 合法、不跨头', () => {
  const M = v => ({ s: ['S', 'H', 'D', 'C', 'S'][v % 5], v }); // 花色错开，避免误判同花顺
  const alow = R([M(14), M(2), M(3), M(4), M(5)], W);
  assert.equal(alow.type, TYPE.STRAIGHT);
  assert.equal(alow.main, 5); // 顶牌=5（A 作最小）
  const high = R([M(10), M(11), M(12), M(13), M(14)], W);
  assert.equal(high.type, TYPE.STRAIGHT);
  assert.equal(high.main, 14); // 顶牌=A
  assert.ok(beats(high, alow)); // 10JQKA > A2345
  // 不跨头：K A 2 3 4 不是顺子
  assert.equal(R([c('S', 13), c('H', 14), c('D', 2), c('C', 3), c('S', 4)], W), null);
  // 含重复点不是顺子（两张自然 5；注意 H5 是逢人配，不能用它凑数）
  assert.equal(R([c('S', 5), c('D', 5), c('H', 6), c('C', 7), c('S', 8)], W), null);
});

test('同花顺=5 张同花连张，力量介于 5 炸与 6 炸', () => {
  const f = R([c('H', 3), c('H', 4), c('H', 5), c('H', 6), c('H', 7)], W);
  // 注意 红桃5=逢人配，此处仍按同花 34567 识别
  assert.equal(f.type, TYPE.STRAIGHT_FLUSH);
  assert.equal(f.main, 7);
});

test('三连对 / 钢板', () => {
  const rp = R([N(4), N(4), N(5), N(5), N(6), N(6)], W);
  assert.equal(rp.type, TYPE.RUNPAIRS);
  assert.equal(rp.main, 6);
  const sp = R([N(8), N(8), N(8), N(9), N(9), N(9)], W);
  assert.equal(sp.type, TYPE.STEELPLATE);
  assert.equal(sp.main, 9);
  // 三连对与钢板是不同牌型（都 power 1），不可互压
  assert.ok(!beats(sp, rp));
  assert.ok(!beats(rp, sp));
  // 官方规则：同型互压，连张不可压基础牌型
  const pair2 = R([N(3), N(3)], W);
  assert.ok(!beats(rp, pair2));  // 三连对 压不了 对子（型不同）
  const triple2 = R([N(3), N(3), N(3)], W);
  assert.ok(!beats(sp, triple2)); // 钢板 压不了 三张（型不同）
  const b4x = R([N(9), N(9), N(9), N(9)], W);
  assert.ok(beats(b4x, rp));     // 4炸 > 三连对（炸压一切非炸）
  // 同型内比顶牌
  const rp2 = R([N(5), N(5), N(6), N(6), N(7), N(7)], W);
  assert.ok(beats(rp2, rp)); // 顶牌 7 > 6
});

test('三带二：主点=三张；wild 补位', () => {
  const tp = R([N(10), N(10), N(10), N(3), N(3)], W);
  assert.equal(tp.type, TYPE.TRIPLE_PAIR);
  assert.equal(tp.main, 8); // 10 的 main=8
  // 3 张 9 + wild 补对子
  const tp2 = R([N(9), N(9), N(9), N(2), WILD], W);
  assert.equal(tp2.type, TYPE.TRIPLE_PAIR);
});

test('wild 可补炸弹/顺子/对子', () => {
  // 3 张 K + 1 wild = 4 张 K 炸
  const b = R([N(13), N(13), N(13), WILD], W);
  assert.equal(b.type, TYPE.BOMB);
  assert.equal(b.main, 11);
  // 4 张自然顺（花色错开）+ wild 补第 5
  const st = R([c('S', 3), c('D', 4), c('S', 5), c('C', 6), WILD], W);
  // 3,4,5,6 缺 7 → wild 顶 7 → 34567 顺（顶牌 7，取最强解读）
  assert.equal(st.type, TYPE.STRAIGHT);
  assert.equal(st.main, 7);
  // 1 张 8 + wild = 8 对
  const p = R([N(8), WILD], W);
  assert.equal(p.type, TYPE.PAIR);
  assert.equal(p.main, 6);
});

test('wild 不能成王：wild+大王 非对子', () => {
  assert.equal(R([WILD, c('J', 'B')], W), null);
});

test('官方同型互压：非炸弹只有型同且张数同才可比；炸弹阶梯 4炸<5炸<同花顺<6炸<天王炸', () => {
  const single = R([N(3)], W);
  const pair = R([N(2), N(2)], W);
  assert.ok(!beats(pair, single)); // 型不同不可互压
  const st = R([c('S',3),c('H',4),c('D',5),c('C',6),c('S',7)], W); // 顺子
  assert.ok(!beats(st, pair));     // 顺子压不了对子（官方）
  assert.ok(!beats(st, single));   // 顺子压不了单张（含大王也压不了）
  const bigJoker = R([c('J','B')], W);
  assert.ok(!beats(st, bigJoker)); // 顺子压不了单张大王
  assert.ok(!beats(pair, st));     // 对子压不了顺子
  const b4 = R([N(9), N(9), N(9), N(9)], W);
  assert.ok(beats(b4, st));       // 4炸 > 顺子
  assert.ok(beats(b4, bigJoker)); // 4炸 > 单张大王
  const b5 = R([N(8), N(8), N(8), N(8), N(8)], W);
  assert.ok(beats(b5, b4));        // 5炸 > 4炸
  const flush = R([c('H',3),c('H',4),c('H',5),c('H',6),c('H',7)], W);
  assert.ok(beats(flush, b5));     // 同花顺 > 5炸
  assert.ok(!beats(b5, flush));
  const b6 = R([N(7), N(7), N(7), N(7), N(7), N(7)], W);
  assert.ok(beats(b6, flush));     // 6炸 > 同花顺
  const sky = R([c('J','B'), c('J','B'), c('J','S'), c('J','S')], W);
  assert.ok(beats(sky, b6));       // 四王（天王炸）最大
});

test('powerOf 表（基础0 / 连张1 / 4炸2 / 5炸3 / 同花顺4 / 6炸5 / 7炸6 / 8炸7 / 天王炸8）', () => {
  assert.equal(powerOf(TYPE.BOMB, 4), 2);
  assert.equal(powerOf(TYPE.BOMB, 5), 3);
  assert.equal(powerOf(TYPE.BOMB, 6), 5);
  assert.equal(powerOf(TYPE.BOMB, 7), 6);
  assert.equal(powerOf(TYPE.BOMB, 8), 7);
  assert.equal(powerOf(TYPE.STRAIGHT_FLUSH, 0), 4);
  assert.equal(powerOf(TYPE.SKYBOMB, 0), 8);
  assert.equal(powerOf(TYPE.STRAIGHT, 0), 1);
  assert.equal(powerOf(TYPE.RUNPAIRS, 0), 1);
  assert.equal(powerOf(TYPE.STEELPLATE, 0), 1);
  assert.equal(powerOf(TYPE.PAIR, 0), 0);
});
