/**
 * 「开局」回归测试（修复：游戏无法自动/手动开始）
 *
 * 根因回顾：
 *  1) 手动开始：GuandanRoom 模板 `@click="newMatch"` 把 MouseEvent 当 seed 传入，
 *     `{} >>> 0 === 0` / `NaN >>> 0 === 0` → 每次点击都得到 seed=0 的同一副牌，
 *     且首局漏掉 AI 调度（先手是 AI 时桌面冻结），表现为"点了开始没反应"。
 *  2) 自动开始：自动模式在每副 handEnd 后停住等点「下一副」，无法"一人看完全场"。
 *
 * 本文件覆盖引擎层修复：sanitizeSeed 归一化 + restore 存档校验 + 开局即可进行。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as engine from '../src/cards/guandan/engine.js';
import { choose } from '../src/cards/guandan/ai.js';
const E = { ...engine, choose };

test('sanitizeSeed：任意输入都归一化为安全 uint31（修复事件对象/NaN 当 seed）', () => {
  // DOM 事件对象（模拟 @click 传入的 MouseEvent）
  const fakeEvent = { type: 'click', x: 10, y: 20 };
  const s1 = E.sanitizeSeed(fakeEvent);
  assert.ok(Number.isInteger(s1) && s1 >= 0 && s1 <= 0x7fffffff, '事件对象 → 合法 seed');
  // NaN / undefined / null / 空串 → 随机兜底，且为合法整数
  for (const bad of [NaN, undefined, null, '', {}, []]) {
    const s = E.sanitizeSeed(bad);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0x7fffffff, `非法输入 ${String(bad)} → 合法 seed`);
  }
  // 数字：负数/小数/超大数均被安全折叠
  assert.equal(E.sanitizeSeed(-1), ((-1 >>> 0) & 0x7fffffff));
  assert.equal(E.sanitizeSeed(3.9), 3);
  assert.equal(E.sanitizeSeed(2 ** 40), (Math.floor(2 ** 40) >>> 0) & 0x7fffffff);
  // 字符串：确定性（同串同 seed）
  assert.equal(E.sanitizeSeed('abc'), E.sanitizeSeed('abc'));
  assert.notEqual(E.sanitizeSeed('abc'), E.sanitizeSeed('abd'));
  // 0 保持为 0（确定性回归依赖）
  assert.equal(E.sanitizeSeed(0), 0);
});

test('createMatch：事件对象/NaN 作 seed 不再冻结成同一副牌', () => {
  const evA = { type: 'click' }, evB = { type: 'click', x: 1 };
  const a = E.createMatch(evA, 0);
  const b = E.createMatch(evB, 0);
  // 两个"事件"都走随机兜底：允许同秒内极小概率相同，但必须是合法对局
  for (const m of [a, b]) {
    assert.ok(['play', 'tribute'].includes(m.phase), '开局即进入可进行状态');
    assert.equal(m.hands.length, 4);
    assert.equal(m.hands.reduce((n, h) => n + h.length, 0), 108);
  }
  // 数字 seed 确定性不受影响
  const c1 = E.createMatch(42), c2 = E.createMatch(42);
  assert.deepEqual(c1.hands.flat().map(x => x.id), c2.hands.flat().map(x => x.id));
  // seed=0（旧 bug 的产物）也是合法对局，但不再是不设防的默认值
  const z = E.createMatch(0);
  assert.ok(z.phase === 'play' || z.phase === 'tribute');
});

test('createMatch 缺省 seed：每次随机不同（不再退化为固定 0）', () => {
  const seeds = new Set();
  for (let i = 0; i < 20; i++) seeds.add(E.createMatch(undefined, 0).seed);
  assert.ok(seeds.size >= 19, `20 次缺省开局应几乎全部不同（实际 ${seeds.size} 种）`);
});

test('createMatch：异常 seed 也一律以归一化后的 m.seed 为准（首副/先手随存档 seed 可复现）', () => {
  // 回归：createMatch 曾拿未归一化的原始输入建 rng（首副先发牌用），与存盘的 m.seed 不同步——
  // 负数/小数/对象 seed 存盘后 restore 出的牌局与原来不一致。修复后首副必须能从 m.seed 复现。
  for (const bad of [{ type: 'click' }, -7, 3.9, 'abc', NaN]) {
    const m = E.createMatch(bad, 0);
    const r = E.createMatch(m.seed, 0);
    assert.equal(m.firstLeader, r.firstLeader, `先手可复现（输入 ${JSON.stringify(bad)}）`);
    assert.deepEqual(
      m.hands.map(h => h.map(c => c.id)),
      r.hands.map(h => h.map(c => c.id)),
      `首副发牌可复现（输入 ${JSON.stringify(bad)}）`
    );
  }
});

test('开局即可进行：play 阶段必有合法首出；tribute 阶段必有合法还贡', () => {
  for (const seed of [0, 1, 7, 42, 12345]) {
    const m = E.createMatch(seed, 0);
    if (m.phase === 'play') {
      const seat = m.turnSeat;
      const d = E.choose(m, seat);
      if (d.pass) throw new Error('首出不应 pass');
      const r = E.play(m, seat, d.cards);
      assert.equal(r.ok, true, `seed=${seed} 开局第一步即可合法出牌（修复"开始后卡住"）`);
    } else {
      assert.equal(m.phase, 'tribute');
      const card = m.hands[m.humanSeat].find(c => E.validReturn(m, c));
      assert.ok(card, `seed=${seed} 还贡局必有合法还贡牌`);
      assert.equal(E.completeReturn(m, card).ok, true);
      assert.equal(m.phase, 'play', '还贡后立即进入出牌');
    }
  }
});

test('restore：损坏存档抛 bad-save（调用方降级新开，不再卡死）', () => {
  assert.throws(() => E.restore('not-json'), '非法 JSON 抛错');
  assert.throws(() => E.restore(JSON.stringify({ phase: 'play' })), /bad-save/, '缺 hands');
  assert.throws(() => E.restore(JSON.stringify({ hands: [[], [], []], phase: 'play', teamLevels: [2, 2] })), /bad-save/, 'hands 不足 4 家');
  assert.throws(() => E.restore(JSON.stringify({ hands: [[], [], [], []], phase: 'weird', teamLevels: [2, 2] })), /bad-save/, '非法 phase');
  assert.throws(() => E.restore(JSON.stringify({ hands: [[], [], [], []], phase: 'play', teamLevels: [2] })), /bad-save/, 'teamLevels 不完整');
  assert.throws(() => E.restore('null'), /bad-save/, 'null 存档');
});

test('restore：正常往返 + tribute 阶段存档可恢复续打', () => {
  // 找一个会进入 tribute 的 seed（人类=收贡方）
  let tributeMatch = null;
  for (let seed = 1; seed < 400 && !tributeMatch; seed++) {
    const m = E.createMatch(seed, 0);
    while (m.phase === 'play') {
      const d = E.choose(m, m.turnSeat);
      d.pass ? E.pass(m, m.turnSeat) : E.play(m, m.turnSeat, d.cards);
    }
    if (m.matchOver) continue;
    E.startHand(m);
    if (m.phase === 'tribute') tributeMatch = m;
  }
  assert.ok(tributeMatch, '应能找到人类需还贡的副牌');
  const restored = E.restore(E.serialize(tributeMatch));
  assert.equal(restored.phase, 'tribute');
  assert.ok(restored.pendingReturn, '待还贡状态保留');
  const card = restored.hands[restored.humanSeat].find(c => E.validReturn(restored, c));
  assert.ok(card, '恢复后存在合法还贡牌');
  assert.equal(E.completeReturn(restored, card).ok, true, '恢复后可手动完成还贡并继续');
  assert.equal(restored.phase, 'play');
});

test('自动整场（模拟"自动开局"）：handEnd 自动续副直到过 A，无需人工点「下一副」', () => {
  for (const seed of [5, 77]) {
    const m = E.createMatch(seed, 0);
    let guard = 0, autoHands = 0;
    while (!m.matchOver && guard++ < 300000) {
      if (m.phase === 'handEnd') {
        // 自动模式的语义：结算后直接开下一副（对应组件 watch(handEnd)→nextHand）
        E.startHand(m);
        autoHands++;
        continue;
      }
      if (m.phase === 'tribute') {
        const card = m.hands[m.humanSeat].find(c => E.validReturn(m, c));
        assert.ok(card, '自动整场遇还贡必有合法牌（组件层此时暂停等手动）');
        E.completeReturn(m, card);
        continue;
      }
      assert.equal(m.phase, 'play');
      const d = E.choose(m, m.turnSeat);
      const r = d.pass ? E.pass(m, m.turnSeat) : E.play(m, m.turnSeat, d.cards);
      assert.equal(r.ok, true, `seed=${seed} 自动整场每步合法`);
    }
    assert.ok(m.matchOver, `seed=${seed} 自动续副可打完整场（${autoHands} 次自动开副）`);
    assert.ok(autoHands >= 1, '至少发生过一次自动续副');
  }
});
