/**
 * 牛牛五档难度统一（v1.53）：3 地域 / 4 绝望 = 恒最优排法 + 庄家宣布翻倍
 *  - dealerDoubleIntent 纯函数：低档（<3）恒 false（零回归），大牌型恒宣布，中/弱牌型按档概率
 *  - autoPlayMatch 集成：region/despair 档每轮经独立 rng 通道 4 决定是否翻倍（不扰动 0-3 座排法流）
 * 钉死：确定性（同 seed 重放）/ 低档零回归（1/2 档永不自宣翻倍）/ 绝望≥地域（宣布频率）/ 零和
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mulberry32 } from '../src/index.js';
import {
  createSession, startRound, autoPlayMatch, dealerDoubleIntent, aiNiuPlan, bestNiu
} from '../src/cards/niuniu.js';

/** 整场驱动后取"每轮是否翻倍"序列（确定性） */
function doubleSeq(seed, level) {
  const sess = createSession(seed, 8, 8);
  autoPlayMatch(sess, level);
  return sess.rounds.map(r => r.doubled);
}

test('低档零回归：L1/L2 整场永不宣布翻倍（翻倍事实源保持全 false）', () => {
  for (const seed of [1, 2, 3]) {
    for (const level of [1, 2]) {
      const seq = doubleSeq(seed, level);
      assert.ok(seq.length >= 1, '整场至少结算 1 轮');
      assert.ok(seq.every(d => d === false), `L${level} 不应出现自宣翻倍`);
    }
  }
});

test('dealerDoubleIntent：level<3 恒 false；大牌型（牛牛 r≥10）恒宣布', () => {
  const sess = createSession(5, 8, 8);
  startRound(sess);
  // 构造庄家大牌型（炸弹=四张 13）：同步覆写 hands + arr（niuFor 按 arr 计牛）
  const bigHand = [
    { id: 'X1', s: 'S', v: 13 }, { id: 'X2', s: 'H', v: 13 }, { id: 'X3', s: 'C', v: 13 },
    { id: 'X4', s: 'D', v: 13 }, { id: 'X5', s: 'S', v: 1 }
  ];
  sess.round.hands[sess.dealer] = bigHand;
  sess.round.arr[sess.dealer] = bestNiu(bigHand).use;
  assert.equal(dealerDoubleIntent(sess, 0, () => 0.5), false, 'L0 不宣布');
  assert.equal(dealerDoubleIntent(sess, 2, () => 0.5), false, 'L2 不宣布');
  assert.equal(dealerDoubleIntent(sess, 3, () => 0.99), true, 'L3 大牌型恒宣布（不消耗 rng）');
  assert.equal(dealerDoubleIntent(sess, 4, () => 0.99), true, 'L4 大牌型恒宣布');
});

test('dealerDoubleIntent：确定性（同 rng 流同结论）且中牌型 L4 概率高于 L3', () => {
  const sess = createSession(6, 8, 8);
  startRound(sess);
  const midHand = [
    { id: 'M1', s: 'S', v: 4 }, { id: 'M2', s: 'S', v: 3 }, { id: 'M3', s: 'S', v: 3 },
    { id: 'M4', s: 'H', v: 5 }, { id: 'M5', s: 'H', v: 4 }
  ];
  sess.round.hands[sess.dealer] = midHand;
  sess.round.arr[sess.dealer] = bestNiu(midHand).use; // 牛九（4+3+3=10 成牛，余 5+4=9）中牌型 5≤r<10，钉死 arr 排除旧索引用
  // 同 rng 值下 L3(0.45)/L4(0.8) 阈值差：0.6 → L3 不宣布、L4 宣布
  assert.equal(dealerDoubleIntent(sess, 3, () => 0.6), false, 'L3 中牌型 0.6>0.45 不宣布');
  assert.equal(dealerDoubleIntent(sess, 4, () => 0.6), true, 'L4 中牌型 0.6<0.8 宣布');
  assert.equal(dealerDoubleIntent(sess, 4, () => 0.9), false, 'L4 中牌型 0.9>0.8 不宣布');
});

test('L3/L4 整场确定性：同 seed 两次 → 翻倍序列/分数/champ 逐字节一致', () => {
  for (const seed of [1, 4, 7]) {
    for (const level of [3, 4]) {
      const s = createSession(seed, 8, 8);
      const a = autoPlayMatch(createSession(seed, 8, 8), level);
      autoPlayMatch(s, level);
      assert.deepEqual(s.rounds.map(r => r.doubled), a.rounds.map(r => r.doubled), `L${level} 翻倍序列可重放`);
      assert.deepEqual(s.scores, a.scores, `L${level} 终局分数可重放`);
      assert.equal(s.champ, a.champ, `L${level} 冠军可重放`);
    }
  }
});

test('宣布频率梯度：绝望(4) ≥ 地域(3)（多 seed 聚合，确定性）', () => {
  let d3 = 0, d4 = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    d3 += doubleSeq(seed, 3).filter(Boolean).length;
    d4 += doubleSeq(seed, 4).filter(Boolean).length;
  }
  assert.ok(d4 >= d3, `L4 宣布次数(${d4}) 应 ≥ L3(${d3})`);
  assert.ok(d3 >= 0 && d4 >= 0, '频率非负');
});

test('L3/L4 翻倍后整场零和（chips off 口径，对齐麻将档测试）：scores 合计恒 0', () => {
  for (const seed of [1, 2, 3]) {
    for (const level of [3, 4]) {
      const sess = createSession(seed, 8, 8);
      sess.chips = []; // 桌面词条旁路资助关闭 → 主账严格零和
      autoPlayMatch(sess, level);
      assert.equal(sess.scores.reduce((a, b) => a + b, 0), 0, `L${level} 零和守恒`);
      assert.ok(sess.rounds.some(r => r.doubled), `L${level} 至少出现一次宣布翻倍（否则档位未生效）`);
    }
  }
});

test('aiNiuPlan 排法层 3/4 档 ≡ 2 档（恒最优，地域/绝望差异只在翻倍宣布层）', () => {
  const hand = [
    { id: 'P1', s: 'S', v: 5 }, { id: 'P2', s: 'H', v: 6 }, { id: 'P3', s: 'C', v: 7 },
    { id: 'P4', s: 'D', v: 8 }, { id: 'P5', s: 'S', v: 9 }
  ];
  const rngA = mulberry32(123);
  const rngB = mulberry32(123);
  const p2 = aiNiuPlan(hand, 2, rngA);
  const p3 = aiNiuPlan(hand, 3, rngB);
  assert.deepEqual(p3.chosen, p2.chosen, 'L3 排法 = L2 最优排法');
});
