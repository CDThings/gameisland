import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession as mjSession, autoPlayMatch as mjAuto
} from '../src/cards/mahjong.js';
import {
  createSession as hdSession, autoPlayMatch as hdAuto
} from '../src/cards/holdem.js';
import {
  createSession as nnSession, autoPlayMatch as nnAuto
} from '../src/cards/niuniu.js';

// v1.29 auto-play：掼蛋 S.auto 的共享可测核心——三桌"让 AI 全自动打完本场"
// 验证：① 整场确实跑完（sess.over）② 同 seed+level 确定性可重放 ③ 各桌不变量（零和/champ 合法）

test('麻将 autoPlayMatch：打完整场（4 局连庄）+ 累计零和 + 确定性', () => {
  for (const level of [0, 1, 2]) {
    const se = mjSession(2026, 0, 4);
    mjAuto(se, level);
    assert.equal(se.over, true, `level=${level} 整场跑完`);
    assert.equal(se.handNo, 4, `level=${level} 换庄 4 次收场（连庄局数 games≥4，不逐局计）`);
    assert.ok(se.games.length >= 4, `level=${level} 至少 4 局（连庄可更多）`);
    assert.ok(se.champ >= 0 && se.champ <= 3, `level=${level} champ 合法座`);
    // 自摸 +3/-1×3、点炮 +1/-1 → 累计严格零和
    assert.equal(se.total.reduce((a, b) => a + b, 0), 0, `level=${level} 累计零和`);
  }
  // 确定性：同 seed+level 两次终局冠军/累计分一致
  const a = mjAuto(mjSession(2026, 0, 4), 1);
  const b = mjAuto(mjSession(2026, 0, 4), 1);
  assert.equal(a.champ, b.champ, '确定性 champion');
  assert.deepEqual(a.total, b.total, '确定性 累计分');
});

test('德州 autoPlayMatch：打满 totalHands 手 + champ 合法 + 确定性', () => {
  for (const level of [0, 2]) {
    const se = hdSession(7, { totalHands: 5, rebuyLimit: 3 });
    hdAuto(se, level);
    assert.equal(se.over, true, `level=${level} 整场跑完`);
    assert.ok(se.handNo <= 5, `level=${level} 手数≤totalHands（全灭可早停）`);
    assert.ok(se.champ >= 0 && se.champ <= 3, `level=${level} champ 合法座`);
  }
  const a = hdAuto(hdSession(7, { totalHands: 5, rebuyLimit: 3 }), 1);
  const b = hdAuto(hdSession(7, { totalHands: 5, rebuyLimit: 3 }), 1);
  assert.deepEqual(a.table.stacks, b.table.stacks, '确定性 终局筹码');
  assert.equal(a.champ, b.champ, '确定性 champion');
});

test('牛牛 autoPlayMatch（chips 关）：打满 hands 轮 + 严格零和 + 确定性', () => {
  for (const level of [0, 1, 2]) {
    const se = nnSession(99, 10, 6);
    se.chips = []; // 关 chip → 严格零和（v1.20 基线不变量）
    nnAuto(se, level);
    assert.equal(se.over, true, `level=${level} 整场跑完`);
    assert.equal(se.roundNo, 6, '打满 6 轮');
    assert.equal(se.scores.reduce((x, y) => x + y, 0), 0, `level=${level} 严格零和`);
    assert.ok(se.champ >= 0 && se.champ <= 3, 'champ 合法座');
  }
  const a = nnAuto((() => { const s = nnSession(99, 10, 6); s.chips = []; return s; })(), 2);
  const b = nnAuto((() => { const s = nnSession(99, 10, 6); s.chips = []; return s; })(), 2);
  assert.deepEqual(a.scores, b.scores, '确定性 累计分');
  assert.equal(a.champ, b.champ, '确定性 champion');
});
