/**
 * 牛牛规则修复（v1.50）：
 *  - 庄家机制改为通行斗牛"连庄"口径：庄家有牛→连庄，无牛→过庄（旧实现"出现大牌型换庄"是反的）
 *  - 翻倍事实源改为 round.doubled（旧 baseBet>10 硬编码在非 10 底注下误判）
 *  - autoPlayMatch 的 AI 派生口径统一到"房间 applyAiPlans"（seed^轮号^座位）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startRound, settleRound, setDouble, autoPlayMatch, roundLog
} from '../src/cards/niuniu.js';

test('庄家连庄口径：庄家有牛→连庄，无牛→过庄顺时针', () => {
  const se = createSession(3, 10, 4);
  startRound(se);
  const d = se.dealer;
  // 无牛手（6,7,8,9,10 任意 3 张和都不是 10 倍数）→ 过庄
  se.round.hands[d] = [
    { s: 'S', v: 6, id: 100 }, { s: 'H', v: 7, id: 101 }, { s: 'D', v: 8, id: 102 },
    { s: 'C', v: 9, id: 103 }, { s: 'S', v: 10, id: 104 },
  ];
  se.round.arr[d] = [0, 1, 2];
  settleRound(se);
  assert.equal(se.dealer, (d + 1) % 4, '庄家无牛 → 过庄顺时针');

  // 有牛手（J=10,9,A=1 → 10+9+1=20 成牛）→ 连庄
  startRound(se);
  const d2 = se.dealer;
  se.round.hands[d2] = [
    { s: 'S', v: 11, id: 110 }, { s: 'H', v: 9, id: 111 }, { s: 'D', v: 1, id: 112 },
    { s: 'C', v: 2, id: 113 }, { s: 'S', v: 3, id: 114 },
  ];
  se.round.arr[d2] = [0, 1, 2];
  const before = se.dealer;
  settleRound(se);
  assert.equal(se.dealer, before, '庄家有牛 → 连庄（座位不变）');
});

test('翻倍事实源 round.doubled：非 10 底注下不再误判（曾硬编码 baseBet>10）', () => {
  const se = createSession(5, 30, 1); // baseBet=30：旧口径 baseBet>10 恒 true（误判"已翻倍"）
  startRound(se);
  assert.equal(se.round.doubled, false, '新轮未翻倍 → doubled=false');
  assert.equal(se.round.baseBet, 30);
  setDouble(se, true);
  assert.equal(se.round.doubled, true, '翻倍后 → doubled=true');
  assert.equal(se.round.baseBet, 60, '底注同步 ×2');
});

test('roundLog.doubled 读 round.doubled（旧档回退 baseBet 口径）', () => {
  const se = createSession(9, 10, 2);
  startRound(se); setDouble(se, true); settleRound(se);
  startRound(se); settleRound(se);
  const log = roundLog(se);
  assert.equal(log[0].doubled, true, '第 1 轮翻倍');
  assert.equal(log[1].doubled, false, '第 2 轮未翻倍');
});

test('autoPlayMatch 确定性：同 seed 同档可重放（口径统一到 seed^轮^座 后仍成立）', () => {
  const a = createSession(77, 10, 6); a.chips = [];
  const b = createSession(77, 10, 6); b.chips = [];
  autoPlayMatch(a, 2);
  autoPlayMatch(b, 2);
  assert.deepEqual(a.scores, b.scores, '累计分逐座一致');
  assert.equal(a.champ, b.champ, '冠军一致');
  assert.equal(a.scores.reduce((x, y) => x + y, 0), 0, '关 chip 严格零和');
});
