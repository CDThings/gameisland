import { test } from 'node:test';
import assert from 'node:assert';
import { createSession, startRound, serialize, restore, autoPlayMatch } from '../src/cards/niuniu.js';
import {
  createSession as createHoldem, startNextHand, autoPlayHand as hdPlay, autoPlayMatch as hdAuto,
  serialize as hdSer, restore as hdRest
} from '../src/cards/holdem.js';
import {
  createSession as createMj, startSessionHand, autoPlayHand as mjPlay, endSessionHand, autoPlayMatch as mjAuto,
  serialize as mjSer, restore as mjRest
} from '../src/cards/mahjong.js';

// v1.41 三桌单机存档 serialize/restore（对齐掼蛋 localStorage「继续上局」，目标① 产品持久化 + ③ 交互）
// 核心不变量：round-trip 幂等 + restore 后引擎可合法续打到终局 + 确定性（rng 按 seed 口径重导）。

test('niuniu: 一轮未结算时 serialize→restore 幂等 + autoPlayMatch 续打完成（8 轮·champ 合法）', () => {
  for (const seed of [1, 7, 42]) {
    const s = createSession(seed, 10, 8);
    startRound(s); // 第 1 轮，未结算
    const json = serialize(s);
    assert.equal(serialize(restore(json)), json, '幂等 round-trip');
    const r = restore(json);
    autoPlayMatch(r, 1);
    assert.equal(r.over, true);
    assert.ok(r.champ >= 0 && r.champ <= 3, `champ=${r.champ}`);
    assert.equal(r.rounds.length, 8, '整场 8 轮');
  }
});

test('holdem: 一手内 serialize→restore 重导 table.rng + 一手打完后续打完成', () => {
  for (const seed of [1, 9, 100]) {
    const s = createHoldem(seed, { totalHands: 10, rebuyLimit: 3 });
    startNextHand(s);
    const midJson = hdSer(s);
    const mid = hdRest(midJson);
    assert.equal(typeof mid.table.rng, 'function', '中途存档 restore 后 table.rng 按 (seed,handNo) 重导');
    hdPlay(s.table, 1); // 第 1 手打到摊牌
    const json = hdSer(s);
    assert.equal(hdSer(hdRest(json)), json, '幂等 round-trip');
    const r = hdRest(json);
    hdAuto(r, 1);
    assert.equal(r.over, true);
    assert.ok(r.champ >= 0 && r.champ <= 3);
  }
});

test('mahjong: 一局内 serialize→restore 重导 game.rng + 一局打完后续打完成 + 严格零和', () => {
  for (const seed of [1, 20, 55]) {
    const s = createMj(seed, 0, 4);
    startSessionHand(s);
    const midJson = mjSer(s);
    const mid = mjRest(midJson);
    assert.equal(typeof mid.game.rng, 'function', '一局内存档 restore 后 game.rng 按 g.seed 重导');
    mjPlay(s.game, 1);
    endSessionHand(s); // 第 1 局完
    const json = mjSer(s);
    assert.equal(mjSer(mjRest(json)), json, '幂等 round-trip');
    const r = mjRest(json);
    mjAuto(r, 1);
    assert.equal(r.over, true);
    assert.ok(r.champ >= 0 && r.champ <= 3);
    assert.equal(r.total.reduce((a, b) => a + b, 0), 0, '麻将累计分严格零和');
  }
});

test('serialize 校验入参 / restore 非法·损坏存档一律抛错（Room 捕获后降级新开）', () => {
  for (const [ser, rest] of [[serialize, restore], [hdSer, hdRest], [mjSer, mjRest]]) {
    assert.throws(() => ser(null), undefined, 'serialize(null) 抛错');
    assert.throws(() => rest('null'), undefined, 'restore(null) 抛错');
    assert.throws(() => rest('{"foo":1}'), undefined, '结构不符 restore 抛错');
  }
});
