import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startRound, settleRound, scoreboard, autoPlayMatch
} from '../src/cards/niuniu.js';

// v1.33 牛牛 整场记分牌（掼蛋"打级方/级牌进度"等价）：scoreboard 的关系不变量

test('scoreboard：空会话=null', () => {
  assert.equal(scoreboard(null), null);
});

test('scoreboard：进行中 leader=argmax、spread=max-min、progress=轮次/总轮', () => {
  const se = createSession(42, 10, 8);
  se.chips = []; // 关 chip → 严格零和，分数分布可预测
  startRound(se);
  settleRound(se); // 第 1 轮
  const b = scoreboard(se);
  assert.equal(b.roundNo, 1);
  assert.equal(b.progress, 1 / 8, 'progress=轮次/总轮');
  assert.equal(b.over, false, '进行中 over=false');
  // 严格零和 → 分数和为 0
  assert.equal(b.scores.reduce((a, x) => a + x, 0), 0);
  // leader = argmax（对当前分数数组自洽）
  const mx = Math.max(...b.scores);
  assert.ok(b.scores[b.leader] === mx, 'leader 处 argmax');
  assert.equal(b.spread, mx - Math.min(...b.scores), 'spread=max-min');
});

test('scoreboard：整场打完 → over=true + progress=1 + 严格零和', () => {
  const se = createSession(7, 10, 6);
  se.chips = [];
  autoPlayMatch(se, 1);
  const b = scoreboard(se);
  assert.equal(b.over, true);
  assert.equal(b.progress, 1, '打满后 progress=1');
  assert.equal(b.roundNo, 6);
  assert.equal(b.scores.reduce((a, x) => a + x, 0), 0, '严格零和（chips 关）');
  assert.ok(b.champ >= 0 && b.champ <= 3, '冠军座合法');
  assert.equal(b.scores[b.champ], Math.max(...b.scores), 'champ=argmax');
});
