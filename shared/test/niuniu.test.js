import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildDeck, bestNiu, niuFor, niuOf, rankOf, beatsN, settle, createRound,
  arrange, autoArrange, multOf, niuDblHint, doubleHint,
  createSession, startRound, settleRound, setDouble
} from '../src/cards/niuniu.js';

const C = (s, v) => ({ s, v, id: undefined });
const withIds = (cards) => cards.map((c, i) => ({ ...c, id: i }));
// 造一手 5 张（含唯一 id）
const hand = (arr) => withIds(arr.map(([s, v]) => ({ s, v })));

test('牌组 52 张不重复', () => {
  const d = buildDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map(c => c.s + c.v)).size, 52);
});

test('排牛：bestNiu 找最优 3 张', () => {
  assert.equal(bestNiu(hand([['S',10],['H',10],['D',10],['C',3],['S',7]])).type, 'niuniu'); // 30+10 余10 → 牛牛
  assert.equal(bestNiu(hand([['S',10],['H',9],['D',1],['C',4],['S',5]])).niu, 9);          // 10+9+1=20 余 4+5=9
  assert.equal(bestNiu(hand([['S',2],['H',3],['D',6],['C',7],['S',9]])).type, 'none');      // 无牛
});

test('niuFor：指定 3 张，组不出牛=无牛；特殊型与排法无关', () => {
  assert.equal(niuFor(hand([['S',2],['H',3],['D',6],['C',7],['S',9]]), [0,1,2]).type, 'none');
  // 炸弹型：4 张 9 → 无论选哪 3 张都是 zhadan
  const z = hand([['S',9],['H',9],['D',9],['C',9],['S',3]]);
  assert.equal(niuFor(z, [0,1,2]).type, 'zhadan');
  assert.equal(niuFor(z, [2,3,4]).type, 'zhadan');
});

test('牌型等级单调：无牛<牛X<牛牛<五花<炸弹<五小', () => {
  const none = rankOf({ type: 'none', niu: 0, cards: [] }).r;
  const niu3 = rankOf({ type: 'niu', niu: 3, cards: [] }).r;
  const niuniu = rankOf({ type: 'niuniu', niu: 10, cards: [] }).r;
  const wuhua = rankOf({ type: 'wuhua', niu: 0, cards: [] }).r;
  const zhadan = rankOf({ type: 'zhadan', niu: 0, cards: [] }).r;
  const wuxiao = rankOf({ type: 'wuxiao', niu: 0, cards: [] }).r;
  assert.ok(none < niu3 && niu3 < niuniu && niuniu < wuhua && wuhua < zhadan && zhadan < wuxiao);
});

test('同型比最大单张：K 花色序 ♠>♥>♣>♦', () => {
  const a = { type: 'niu', niu: 3, cards: [C('S',13)] };
  const b = { type: 'niu', niu: 3, cards: [C('H',13)] };
  assert.ok(beatsN(a, b));
});

test('倍率：无牛1 / 牛1-8为2 / 牛九3 / 牛牛4 / 五花·炸5 / 五小6', () => {
  assert.equal(multOf({ type: 'none', niu: 0, cards: [] }), 1);
  assert.equal(multOf({ type: 'niu', niu: 3, cards: [] }), 2);
  assert.equal(multOf({ type: 'niu', niu: 8, cards: [] }), 2);
  assert.equal(multOf({ type: 'niu', niu: 9, cards: [] }), 3);
  assert.equal(multOf({ type: 'niuniu', niu: 10, cards: [] }), 4);
  assert.equal(multOf({ type: 'wuhua', niu: 0, cards: [] }), 5);
  assert.equal(multOf({ type: 'zhadan', niu: 0, cards: [] }), 5);
  assert.equal(multOf({ type: 'wuxiao', niu: 0, cards: [] }), 6);
});

test('settle=两两互赔：零和、弱者付强者=底注×强者倍率', () => {
  const r = createRound(1, 10);
  // 手工固定 4 家牌型，便于算账：0=牛牛,1=牛九,2=无牛,3=牛七
  r.hands = [
    withIds([{s:'S',v:10},{s:'H',v:10},{s:'D',v:10},{s:'C',v:3},{s:'S',v:7}]), // 30+10 余10 牛牛
    withIds([{s:'S',v:10},{s:'H',v:9},{s:'D',v:1},{s:'C',v:4},{s:'S',v:5}]),   // 20 余9 牛九
    withIds([{s:'S',v:2},{s:'H',v:3},{s:'D',v:6},{s:'C',v:7},{s:'S',v:9}]),    // 无牛
    withIds([{s:'S',v:9},{s:'H',v:9},{s:'D',v:9},{s:'C',v:3},{s:'S',v:7}]),    // 27? 9+9+9=27 非10倍数 → 无牛；用 9,1,10? 用 10,9,1=20
  ];
  r.hands[3] = withIds([{s:'S',v:10},{s:'H',v:9},{s:'D',v:1},{s:'C',v:8},{s:'S',v:3}]); // 20 余 8+3=11 → 牛一
  const s = settle(r);
  assert.equal(s.deltas.reduce((a, b) => a + b, 0), 0, '零和');
  assert.equal(s.transfers.length, 6, 'C(4,2)=6 对');
  assert.ok(s.transfers.every(t => t.amount >= 0 && Number.isFinite(t.amount)));
  // 牛牛(0) 应最大牌之一 → bigSeats 含 0
  assert.ok(s.bigSeats.includes(0), '牛牛在最大牌之列');
});

test('排牌交互：arrange 自选 3 张改变牛型；autoArrange 回最优；亮牌后锁定', () => {
  const r = createRound(5, 10);
  const myCards = r.hands[0];
  // 选一组必然无牛的 3 张（同花色低 3 张）
  const bad = [myCards[0].id, myCards[1].id, myCards[2].id];
  const before = niuOf(r, 0);
  const res = arrange(r, 0, bad);
  assert.equal(res.ok, true);
  const after = niuOf(r, 0);
  // 自选后牛型可能变差（无牛），autoArrange 回最优
  const auto = autoArrange(r, 0);
  assert.equal(auto.ok, true);
  assert.ok(rankOf(auto.niu).r >= rankOf(after).r || rankOf(after).r === 0, '最优≥自选或自选无牛');
  // 亮牌后锁
  settle(r);
  assert.equal(arrange(r, 0, bad).ok, false, '亮牌后不可再排');
  assert.equal(before, before); // no-op
});

test('setDouble：结算前翻倍底注，付款额翻倍', () => {
  const sess = createSession(9, 10, 2);
  startRound(sess);
  setDouble(sess, true);
  assert.equal(sess.round.baseBet, 20, '翻倍底注=20');
  const s = settleRound(sess);
  assert.equal(s.deltas.reduce((a, b) => a + b, 0), 0, '翻倍后仍零和');
});

test('整场 8 轮：净和=资助额（倍率零和 + 底注外 chip 资助）+ 冠军=累计最高（含翻倍轮）', () => {
  for (let seed of [1, 7, 42, 99, 2026]) {
    const sess = createSession(seed, 10, 8);
    let k = 0;
    let totalChipBonus = 0;
    while (!sess.over) {
      startRound(sess);
      if (k % 3 === 0) setDouble(sess, true);
      const r = settleRound(sess);
      totalChipBonus += r.chipBonus || 0;
      k++;
    }
    assert.equal(sess.rounds.length, 8);
    // 倍率部分严格零和；净和只来自"底注外资助"chipBonus（v1.20 桌面词条）
    assert.equal(sess.scores.reduce((a, b) => a + b, 0), totalChipBonus, `seed=${seed} 净和=资助额`);
    assert.ok(sess.champ >= 0 && sess.champ < 4, '有冠军');
    assert.equal(sess.scores[sess.champ], Math.max(...sess.scores), '冠军=累计最高');
  }
});

test('chips 关闭时严格零和（基线不变量回归）', () => {
  for (let seed of [1, 7, 42]) {
    const sess = createSession(seed, 10, 8);
    sess.chips = []; // 关闭桌面词条 → 回到纯零和
    let k = 0;
    while (!sess.over) {
      startRound(sess);
      if (k % 3 === 0) setDouble(sess, true);
      settleRound(sess);
      k++;
    }
    assert.equal(sess.scores.reduce((a, b) => a + b, 0), 0, `seed=${seed} chips 关闭严格零和`);
  }
});

// v1.24 翻倍意向（信息显示小心思，对齐掼蛋"报牌"）：按牛型强度给"可/不宜翻倍"文案
test('翻倍意向：niuDblHint 三档阈值（strong≥10 / hold 5-9 / skip<5）+ doubleHint(hand) 端到端', () => {
  // niuDblHint 直接吃 niu 结果（rankOf 阈值）
  assert.equal(niuDblHint({ type: 'niu', niu: 5 }).suggest, 'hold');
  assert.equal(niuDblHint({ type: 'niu', niu: 9 }).suggest, 'hold');
  assert.equal(niuDblHint({ type: 'niu', niu: 4 }).suggest, 'skip');   // 牛四 r=4 <5
  assert.equal(niuDblHint({ type: 'niuniu', niu: 10 }).strong, true);  // 牛牛 r=10
  assert.equal(niuDblHint({ type: 'niuniu', niu: 10 }).suggest, 'double');
  assert.equal(niuDblHint({ type: 'zhadan', niu: 0 }).strong, true);  // 炸弹 r=12
  assert.equal(niuDblHint({ type: 'wuxiao' }).strong, true);          // 五小 r=13
  assert.equal(niuDblHint({ type: 'wuhua' }).strong, true);           // 五花 r=11
  assert.equal(niuDblHint({ type: 'none' }).suggest, 'skip');         // 无牛 r=0
  // 端到端：doubleHint(hand)=niuDblHint(bestNiu(hand))
  assert.equal(doubleHint(hand([['S', 10], ['H', 10], ['D', 10], ['C', 3], ['S', 7]])).strong, true);  // 牛牛
  assert.equal(doubleHint(hand([['S', 2], ['H', 3], ['D', 6], ['C', 7], ['S', 9]])).suggest, 'skip');  // 无牛
  // 文案非空且可辨强弱
  assert.match(niuDblHint({ type: 'niuniu', niu: 10 }).text, /可翻倍/);
  assert.match(niuDblHint({ type: 'none' }).text, /不宜翻倍/);
});
