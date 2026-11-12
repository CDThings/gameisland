/**
 * 麻将规则补齐（v1.51）——新特性 + 零回归钉定：
 *  - 十三幺 胡牌判定与 +6 番
 *  - 色种番（清一色 +2 / 混一色 +1 / 全数色 +1，互斥）
 *  - 杠上花（viaGang +1 番 + 事件区分 + 胡牌张=补牌张）
 *  - 加杠（碰升杠，副露 4 张守恒）
 *  - 胡牌张记录（点炮=点炮张）
 *  - 地域/绝望档（aiLevel 3/4）加权听口 + 整场确定性零和
 *  - 存档 rng 可序列化（ADR-5 中途重放）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  canHu, isThirteen, fanOf, fanDetail, createGame, createSession, startSessionHand,
  selfWinCheck, jiaGang, jiaGangOptions, weightedWaits, autoPlayHand,
  doClaim, serialize, restore, endSessionHand
} from '../src/cards/mahjong.js';

test('fanDetail：分项 = fanOf 总和（同一判定源）+ 十三幺/清一色分项可见', () => {
  const g = createGame(1, 0);
  // 十三幺（自摸）
  g.hands[0] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 0]; g.melds[0] = [];
  let d = fanDetail(g, 0, true, false);
  assert.ok(d.parts.some(([n]) => n === '十三幺'), '十三幺分项');
  assert.equal(d.total, fanOf(g, 0, true), 'fanDetail.total ≡ fanOf');
  // 清一色（全筒，门清自摸）
  g.hands[0] = [9, 10, 11, 12, 13, 14, 15, 16, 17, 9, 9, 9, 11, 11];
  d = fanDetail(g, 0, true, false);
  assert.ok(d.parts.some(([n, f]) => n === '清一色' && f === 2), '清一色 +2 分项');
  assert.equal(d.total, fanOf(g, 0, true), 'fanDetail.total ≡ fanOf（清一色）');
  // 碰碰胡（全刻）
  g.hands[0] = [0, 0, 0, 9, 9, 9, 18, 18, 18, 10, 10, 10, 5, 5];
  d = fanDetail(g, 0, false, false);
  assert.ok(d.parts.some(([n]) => n === '碰碰胡'), '碰碰胡分项');
  assert.equal(d.total, fanOf(g, 0, false), 'fanDetail.total ≡ fanOf（碰碰）');
});

test('十三幺：canHu 判定 + 番 +6（封顶 8）', () => {
  const shisan = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 0]; // 13 幺九 + 一万对
  assert.ok(isThirteen(shisan), 'isThirteen=true');
  assert.ok(canHu(shisan), '十三幺可胡');
  const fake = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 32, 32]; // 缺 33、32 三张
  assert.ok(!isThirteen(fake), '缺幺九/非成对=非十三幺');
  const g = createGame(1, 0);
  g.hands[0] = shisan; g.melds[0] = [];
  assert.equal(fanOf(g, 0, true), 8, '十三幺自摸封顶 8 番');
});

test('色种番：清一色+2 / 混一色+1 / 全数色+1（互斥）', () => {
  const mk = (hand) => ({ melds: [[], [], [], []], hands: { 0: hand } });
  const qing = [9, 10, 11, 12, 13, 14, 15, 16, 17, 9, 9, 9, 11, 11];
  assert.equal(fanOf(mk(qing), 0, false), 4, '清一色 +2（基础1+门清1+清一色2）');
  const hun = [9, 9, 9, 10, 11, 12, 13, 14, 15, 16, 16, 16, 27, 27];
  assert.equal(fanOf(mk(hun), 0, false), 3, '混一色 +1（基础1+门清1+混一色1）');
  const quansu = [0, 1, 2, 9, 10, 11, 18, 19, 20, 5, 5, 5, 13, 13];
  assert.equal(fanOf(mk(quansu), 0, false), 3, '全数色 +1（基础1+门清1+全数色1）');
});

test('杠上花：viaGang +1 番 + 事件「杠上花」+ 胡牌张=补牌张', () => {
  const g = createGame(7, -1);
  g.hands[0] = [9, 9, 9, 10, 11, 12, 13, 14, 15, 16, 16, 16, 27, 27]; g.melds[0] = [];
  g.lastDrawn[0] = 27;
  assert.ok(selfWinCheck(g, 0, true), '补牌胡成立');
  assert.equal(g.events[g.events.length - 1].k, '杠上花', '事件=杠上花');
  assert.equal(g.lastWin.viaGang, true, 'lastWin.viaGang=true');
  assert.equal(g.lastWin.tile, 27, '胡牌张=补牌张');
  assert.equal(fanOf(g, 0, true, true), 5, '基础1+门清1+自摸1+混一色1+杠上花1=5');
});

test('加杠：碰升杠 + 补牌 + 副露按 4 张计', () => {
  const g = createGame(42, 0);
  g.phase = 'discard'; g.turn = 0; g.selfHuPending = false;
  g.melds[0] = [{ kind: 'peng', tile: 5 }];
  g.hands[0] = [5, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 5, 8]; // 14 张（打阶段）含 2 张 5
  assert.deepEqual(jiaGangOptions(g, 0), [5], '加杠可选=碰过的 5');
  const before = g.wall.length;
  assert.equal(jiaGang(g, 0, 5).ok, true, '加杠成功');
  assert.equal(g.melds[0][0].kind, 'jiagang', '副露升为加杠');
  assert.equal(g.wall.length, before - 1, '墙尾补一张');
  assert.equal(g.hands[0].length, 14, '手牌 14→打阶段仍 14（移 1 补 1）');
  assert.ok(g.hands[0].filter(x => x === 5).length <= 2, '第 4 张 5 已归副露（手牌至多补回一张 5）');
  const g2 = createGame(43, 0);
  g2.phase = 'discard'; g2.turn = 0; g2.selfHuPending = false;
  g2.melds[0] = [{ kind: 'peng', tile: 6 }];
  g2.hands[0] = [0, 1, 2, 9, 10, 11, 18, 19, 20, 27, 28, 5, 8, 3];
  assert.deepEqual(jiaGangOptions(g2, 0), [], '无第 4 张不可加杠');
  assert.equal(jiaGang(g2, 0, 6).ok, false, '非法加杠拒绝');
});

test('胡牌张记录：点炮=点炮张（lastWin.tile / selfDrawn=false）', () => {
  const g = createGame(11, -1);
  g.hands[0] = [0, 0, 0, 1, 2, 3, 10, 11, 12, 18, 19, 20, 5]; g.melds[0] = [];
  g.phase = 'claim';
  g.lastDiscard = 5; g.lastFrom = 1; g.discards[1].push(5);
  g.claimPending = { tile: 5, from: 1, cur: 0, queue: [{ s: 0, hu: true, gang: false, peng: false }] };
  const r = doClaim(g, 0, 'hu');
  assert.equal(r.hu, true, '点炮胡');
  assert.equal(g.lastWin.tile, 5, '胡牌张=点炮的 5');
  assert.equal(g.lastWin.selfDrawn, false, '非自摸');
});

test('地域/绝望档（3/4）：加权听口纯函数 + 整场确定性零和', () => {
  const g = createGame(5, 0);
  const hand13 = g.hands[0].slice(0, 13);
  assert.equal(weightedWaits(g, 0, hand13), weightedWaits(g, 0, hand13), 'weightedWaits 确定性');
  assert.ok(weightedWaits(g, 0, hand13) >= 0, '加权听口非负');
  for (const lv of [3, 4]) {
    const a = createSession(313, 0, 4); a.chips = [];
    let guard = 0;
    while (!a.over && guard++ < 200) { const gg = startSessionHand(a); autoPlayHand(gg, lv); endSessionHand(a); }
    assert.equal(a.total.reduce((x, y) => x + y, 0), 0, `level=${lv} 关 chip 严格零和`);
    const b = createSession(313, 0, 4); b.chips = [];
    guard = 0;
    while (!b.over && guard++ < 200) { const gg = startSessionHand(b); autoPlayHand(gg, lv); endSessionHand(b); }
    assert.deepEqual(a.total, b.total, `level=${lv} 确定性（同 seed 同档重放）`);
  }
});

test('存档 rng 可序列化：restore 后 rng 状态保留（ADR-5 中途重放）', () => {
  const sess = createSession(424, 0, 4);
  const g = startSessionHand(sess);
  autoPlayHand(g, 3);
  const s2 = restore(serialize(sess));
  assert.ok(typeof s2.game.rngS === 'number', 'rngS 随档保留');
  assert.ok(typeof s2.game.rng === 'function', 'rng 已重绑到存档状态');
  assert.ok(Number.isFinite(s2.game.rng()), '可继续取随机数');
});
