/**
 * 德州规则修复（v1.50）：
 *  - heads-up 盲注口径（button=SB / 对家=BB，preflop SB 先行动）
 *  - 短 all-in 后"已行动者"不重开加注权、未行动者保留（标准 NLHE 口径钉住）
 *  - allin 退化为跟平时按 call 记账/记日志（不再误标"全下"）
 *  - runout 摊牌 results.street=实际最后下注街（不再误报推进后的街）
 *  - 存档 rng 状态随 JSON 序列化 → "继续上局"AI 重放精确（ADR-5）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  createTable, createSession, startHand, startNextHand, act, legalActions, aiDecide,
  handOver, serialize, restore
} from '../src/cards/holdem.js';

test('heads-up 盲注：button=SB、对家=BB（旧实现反了）', () => {
  for (const seed of [1, 7, 42]) {
    const t = createTable(seed, { startStack: 1000 });
    t.stacks[2] = 0; t.stacks[3] = 0; // 只余 0、1 两家
    startHand(t);
    assert.equal(t.button, 0, `seed=${seed} 移庄落到 0`);
    assert.equal(t.hand.sb, 0, `seed=${seed} button=SB`);
    assert.equal(t.hand.bb, 1, `seed=${seed} 对家=BB`);
    assert.equal(t.hand.toAct, 0, `seed=${seed} heads-up preflop SB(button) 先行动`);
    assert.equal(t.stacks[0], 990, 'SB 扣 10');
    assert.equal(t.stacks[1], 980, 'BB 扣 20');
  }
});

test('≥3 人时盲注不变（button 左手=SB，零回归）', () => {
  const t = createTable(5);
  startHand(t);
  assert.equal(t.hand.sb, (t.button + 1) % 4, '4 人桌 SB=button 下家');
  assert.equal(t.hand.bb, (t.button + 2) % 4, 'BB=SB 下家');
});

test('短 all-in：已行动者不重开加注权，BB(未行动) 保留（官方口径）', () => {
  const t = createTable(9);
  startHand(t);
  const h = t.hand;
  // 剧本：3 弃 → 0 足额加到 100（minRaise 20→80）→ 1 短 all-in 到 130（inc 30 < 80）
  act(t, 3, 'fold');
  act(t, 0, 'raise', 100);
  assert.equal(h.minRaise, 80, '足额加注更新 minRaise');
  t.stacks[1] = 120; // 1 已投 10 → raiseMax=130 → 短 all-in（inc=30）
  const r1 = act(t, 1, 'allin');
  assert.equal(r1.ok, true);
  assert.equal(h.currentBet, 130, '短 all-in 抬升下注级别');
  assert.equal(h.minRaise, 80, '短 all-in 不更新 minRaise');
  assert.equal(h.allin[1], true, '1 全下标记');
  // toAct=2（BB option，未在该级别行动）
  const la2 = legalActions(t, 2);
  assert.equal(la2.canRaise, true, 'BB 未行动过该级别 → 保留加注权');
  act(t, 2, 'call'); // 跟平 130
  // toAct=0：0 在 100 级别行动过（足额加注），短 all-in 不重开其加注权
  const la0 = legalActions(t, 0);
  assert.equal(la0.canRaise, false, '已行动者不重开（标准短 all-in 口径）');
  assert.equal(la0.canCall, true, '但可跟平');
});

test('allin 退化为跟平 → 按 call 记账记日志（不误标"全下"）', () => {
  const t = createTable(13);
  startHand(t);
  // preflop（sb=1, bb=2, 0 无盲）：3 弃 → 0 加 100 → 1 跟 → 2 跟 → 翻牌
  act(t, 3, 'fold');
  act(t, 0, 'raise', 100);
  act(t, 1, 'call');
  act(t, 2, 'call');
  assert.equal(t.hand.street, 'flop');
  // 翻牌：1 加到 60 → 2 余栈不足 → allin 只是"跟到 30"
  act(t, 1, 'raise', 60);
  t.stacks[2] = 30; // raiseMax=30 < 60 → 退化
  const r2 = act(t, 2, 'allin');
  assert.equal(r2.ok, true, '退化 allin 被接受');
  const last = t.history[t.history.length - 1];
  assert.equal(last.type, 'call', '记为 call 而非 allin');
  assert.equal(last.pay, 30, '实付=余栈');
  assert.equal(t.stacks[2], 0, '余栈清零');
  assert.equal(t.hand.allin[2], true, '全下标记');
  assert.equal(t.hand.currentBet, 60, '不抬升下注级别');
});

test('runout 摊牌 results.street=实际最后下注街（翻牌全下 runout ≠ 转牌）', () => {
  const t = createTable(21);
  startHand(t);
  // preflop（sb=1, bb=2）：3 弃 → 0 加 100 → 1 跟 → 2 跟 → 翻牌
  act(t, 3, 'fold');
  act(t, 0, 'raise', 100);
  act(t, 1, 'call');
  act(t, 2, 'call');
  assert.equal(t.hand.street, 'flop');
  // 翻牌全下 runout：1 加 30 → 2、0 余栈不足全下（退化跟平）→ 全员 all-in 直接发完
  t.stacks[1] = 30; // 翻牌 streetCommitted=0 → raiseMax=30
  act(t, 1, 'raise', 30);
  t.stacks[2] = 20;
  act(t, 2, 'allin'); // 20 < 30 → 退化跟平
  t.stacks[0] = 25;
  const r0 = act(t, 0, 'allin'); // 25 < 30 → 退化跟平
  assert.equal(r0.ok, true);
  assert.ok(handOver(t), '全下 runout → 直接摊牌');
  assert.equal(t.hand.results.kind, 'showdown');
  assert.equal(t.hand.results.street, 'flop', 'street=flop（旧实现误报 turn/river）');
  assert.equal(t.hand.board.length, 5, '公共牌发满 5 张');
});

test('存档 rng 可序列化：restore 后继续与内存中继续结果一致（ADR-5 重放）', () => {
  const drive = (t, n) => {
    for (let i = 0; i < n && !handOver(t); i++) {
      const s = t.hand.toAct;
      const d = aiDecide(t, s, 1);
      const r = act(t, s, d.action, d.amount);
      assert.ok(r.ok, `动作合法 ${d.action}`);
    }
  };
  const sa = createSession(42, { totalHands: 3 });
  startNextHand(sa);
  drive(sa.table, 3); // 本手中途（未摊牌）存档
  const snap = serialize(sa);
  const sb = restore(snap);
  drive(sa.table, 60);
  drive(sb.table, 60);
  assert.deepEqual(sb.table.stacks, sa.table.stacks, 'restore 续打 = 内存续打（rng 状态精确重放）');
  assert.equal(sb.over, sa.over, '整场终局一致');
  // 旧档兼容：无 rngS → 按起手重导（不抛错、可继续）
  const legacy = JSON.parse(snap);
  delete legacy.table.rngS;
  const s2 = restore(JSON.stringify(legacy));
  assert.ok(typeof s2.table.rngS === 'number', '旧档 rngS 兜底重导');
  drive(s2.table, 5);
});
