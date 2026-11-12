import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startRound, settleRound, setDouble, autoPlayMatch, roundLog
} from '../src/cards/niuniu.js';

// v1.34 牛牛 整场结算日志（对齐掼蛋 playlog / 德州下注日志 / 麻将弃牌河）：roundLog 的关系不变量

test('roundLog：无 rounds = 空', () => {
  const se = createSession(1, 10, 8);
  assert.deepEqual(roundLog(se), []);
  assert.deepEqual(roundLog(null), []);
});

test('roundLog：整场（chips 关）每条净分零和 + winners=净正座 + 无翻倍', () => {
  const se = createSession(42, 10, 6);
  se.chips = [];
  autoPlayMatch(se, 1);
  const log = roundLog(se);
  assert.equal(log.length, se.rounds.length, '日志条数=已结算轮数');
  for (const e of log) {
    assert.equal(e.net.reduce((a, b) => a + b, 0), 0, `R${e.roundNo} 严格零和`);
    const expectWinners = [];
    for (let i = 0; i < e.net.length; i++) if (e.net[i] > 0) expectWinners.push(i);
    assert.deepEqual(e.winners, expectWinners, `R${e.roundNo} winners=净正座`);
    assert.equal(e.doubled, false, 'autoPlay 未 setDouble → 无翻倍');
  }
});

test('roundLog：setDouble 轮 → doubled=true 且该轮金额翻倍（净和仍 0）', () => {
  const se = createSession(7, 10, 2);
  se.chips = [];
  startRound(se);
  setDouble(se, true); // 本轮底注 ×2
  settleRound(se);
  const log = roundLog(se);
  assert.equal(log.length, 1);
  assert.equal(log[0].doubled, true, 'setDouble 轮 doubled=true');
  assert.equal(log[0].net.reduce((a, b) => a + b, 0), 0, '翻倍后仍严格零和');
});
