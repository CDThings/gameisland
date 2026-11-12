/**
 * 规则审计修复锁定（2026-09-30）：四桌引擎审查发现的高危 bug 回归用例。
 *  - 麻将：发牌 13/14（曾 4/5）、声明胡>杠>碰优先级、明杠/暗杠后墙尾补牌、aiDiscard 方向、豪华七对、碰碰胡番、selfWinCheck
 *  - 德州：盲注计入本街、每街独立下注轮（曾整体跳过）、BB option、短 all-in 不重开、第 10 手打完才收场（筹码守恒）
 *  - 牛牛：炸弹同型比四张点数（曾比 kicker）
 *  - 掼蛋：play() 重复牌拒绝、双下大贡配头游
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildWall, canHu, waits, createGame, createSession, startSessionHand, endSessionHand,
  discard, doClaim, selfHu, aiDiscard, gameover, fanOf, selfWinCheck, anGang, anGangOptions
} from '../src/cards/mahjong.js';
import {
  createTable, startHand, act, legalActions, aiDecide, handOver,
  createSession as holdemCreateSession, startNextHand
} from '../src/cards/holdem.js';
import { settle, cmpKeyOf, niuFor } from '../src/cards/niuniu.js';
import { applyTribute, play as gdPlay } from '../src/cards/guandan/engine.js';

// ───────────────────────────── 麻将 ─────────────────────────────

test('麻将发牌：每家 13 张、庄家 14 张、墙余 83（修复：曾每家 4 张）', () => {
  for (const seed of [1, 7, 42, 99, 12345]) {
    const g = createGame(seed, 0, 0);
    assert.equal(g.hands[0].length, 14, `seed=${seed} 庄 14 张`);
    assert.equal(g.hands[1].length, 13);
    assert.equal(g.hands[2].length, 13);
    assert.equal(g.hands[3].length, 13);
    assert.equal(g.wall.length, 83, `seed=${seed} 136-53=83`);
  }
});

test('声明优先级：下家可碰但更远家可胡 → 胡胜出（修复：曾按座位号询问，碰截胡）', () => {
  const g = createGame(7, -1);
  g.hands[0] = [27, 0, 0, 0, 1, 2, 3, 10, 11, 12, 18, 19, 20]; // 打 27
  g.hands[1] = [27, 27, 4, 5, 6, 14, 15, 16, 22, 23, 24, 31, 32]; // 可碰 27（不能胡）
  g.hands[2] = [2, 5, 8, 11, 14, 17, 20, 23, 26, 28, 29, 30, 33]; // 无声明
  g.hands[3] = [27, 27, 0, 0, 0, 1, 2, 3, 10, 11, 12, 18, 18]; // +27 → 000+27刻+123+10,11,12+18雀 胡
  g.phase = 'discard'; g.turn = 0; g.lastDiscard = null;
  const r = discard(g, 0, 27);
  assert.ok(r.ok, '打牌合法');
  assert.equal(g.winner, 3, 'seat3 胡（优先于 seat1 碰）');
  assert.equal(g.phase, 'over');
});

test('明杠后墙尾补牌：手牌 13-3+1=11 且 136 守恒（修复：曾无补牌，杠家永久无法胡）', () => {
  for (const seed of [3, 11, 21]) {
    const g = createGame(seed, -1);
    g.hands[0] = [27, 0, 0, 0, 1, 2, 3, 10, 11, 12, 18, 19, 20];
    g.hands[1] = [27, 27, 27, 4, 5, 6, 14, 15, 16, 22, 23, 24, 31]; // 三张 27 → 点炮杠
    g.hands[2] = [2, 5, 8, 11, 14, 17, 20, 23, 26, 28, 29, 30, 33];
    g.hands[3] = [2, 5, 8, 11, 14, 17, 20, 23, 26, 28, 29, 30, 32];
    g.phase = 'discard'; g.turn = 0; g.lastDiscard = null;
    discard(g, 0, 27); // 无胡声明 → seat1 杠（AI：waits=0 不保听？手 27,27,27+三顺 → 听牌？保听则 pass → advance）
    if (g.claimPending && g.claimPending.cur === 1) {
      const o = { gang: true, peng: true, hu: false };
      void o;
      doClaim(g, 1, 'gang'); // 强制杠（AI 可能因听牌 pass，用直接声明锁定补牌路径）
    }
    if (g.melds[1].length === 1) {
      assert.equal(g.hands[1].length, 11, `seed=${seed} 杠后补牌手 11 张`);
      const inMelds = g.melds.flat().reduce((n, m) => n + (m.kind === 'gang' ? 4 : 3), 0);
      assert.equal(g.wall.length + g.hands.flat().length + g.discards.flat().length + inMelds, 136, '136 守恒');
      if (g.phase === 'discard' && g.turn === 1) {
        discard(g, 1, aiDiscard(g, 1));
        assert.equal(g.hands[1].length, 10, '杠后打牌 → 10 张（mod3=1 可继续胡）');
      }
    }
  }
});

test('aiDiscard：孤字牌先打、不拆顺/刻、保听（修复：曾打分反向，拆成牌留孤字）', () => {
  const g = createGame(1, -1);
  g.hands[0] = [27, 0, 1, 2, 9, 9, 13, 13, 13, 22, 23, 24, 31, 32]; // 摸后 14 张
  const d = aiDiscard(g, 0);
  assert.ok([27, 31, 32].includes(d), `孤字牌先打（实际=${d}），不拆顺不打对`);
  // 保听：打 27 后可听 5；打别的全不听 → 必打 27
  g.hands[1] = [0, 0, 1, 2, 3, 9, 10, 11, 18, 19, 20, 5, 5, 27];
  assert.equal(aiDiscard(g, 1), 27, '唯一保听打点');
  assert.ok(waits([0, 0, 1, 2, 3, 9, 10, 11, 18, 19, 20, 5, 5]).length > 0, '打 27 后确为听牌');
});

test('豪华七对（含四张）可胡（修复：曾只认 7 个不同对子）', () => {
  assert.ok(canHu([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]), '四张算两对');
  assert.ok(canHu([0, 0, 1, 1, 2, 2, 9, 9, 10, 10, 11, 11, 27, 27]), '普通七对');
  assert.ok(!canHu([27, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32, 32, 33]), '字牌杂凑不胡');
});

test('碰碰胡 +2 番（修复：曾只看副露数，顺子胡也加番）', () => {
  const mk = (melds, hand) => ({ melds, hands: { 0: hand } });
  // 暗手碰碰胡：000 111 999 18,18,18 + 5,5 雀
  const g1 = mk([], [0, 0, 0, 9, 9, 9, 18, 18, 18, 10, 10, 10, 5, 5].map(x => x).slice());
  void g1;
  const g = { melds: [[], [], [], []], hands: { 0: [0, 0, 0, 9, 9, 9, 18, 18, 18, 10, 10, 10, 5, 5] } };
  const f1 = fanOf(g, 0, false); // 基础1+门清1+碰碰2=4（点炮无自摸）
  assert.ok(f1 >= 4, `暗手碰碰胡≥4 番（实际 ${f1}）`);
  // 有副露顺子胡不加碰碰番
  const g2 = { melds: [[{ kind: 'peng', tile: 27 }], [], [], []], hands: { 0: [0, 0, 1, 2, 3, 10, 11, 12, 18, 19, 20, 5] } };
  const f2 = fanOf(g2, 0, false); // 基础1（无门清）=1
  assert.equal(f2, 1, `顺子胡不加碰碰番（实际 ${f2}）`);
});

test('selfWinCheck：AI 座位直接胡结算；人类座位置 selfHuPending（天胡/补牌共用）', () => {
  const win14 = [0, 0, 0, 1, 2, 3, 10, 11, 12, 18, 19, 20, 5, 5];
  const gAI = createGame(1, -1, 0);
  gAI.hands[0] = win14.slice();
  assert.equal(selfWinCheck(gAI, 0), true);
  assert.equal(gAI.winner, 0); assert.equal(gAI.phase, 'over');
  const gHu = createGame(1, 0, 0);
  gHu.hands[0] = win14.slice();
  assert.equal(selfWinCheck(gHu, 0), true);
  assert.equal(gHu.selfHuPending, true, '人类 → 等玩家点自摸胡');
  assert.equal(gHu.winner, null);
});

test('人类暗杠：anGangOptions/anGang 补牌后手 11 张（修复：人类无暗杠通道）', () => {
  const g = createGame(2, 0, 0);
  g.hands[0] = [0, 0, 0, 0, 1, 2, 3, 10, 11, 12, 18, 19, 20, 5]; // 14 张含四张 0
  assert.deepEqual(anGangOptions(g, 0), [0]);
  const r = anGang(g, 0, 0);
  assert.ok(r.ok, '暗杠合法');
  assert.equal(g.hands[0].length, 11, '14-4+补1=11');
  assert.equal(g.melds[0].length, 1);
  assert.equal(g.melds[0][0].concealed, true);
  assert.ok(g.phase === 'discard', '补牌后继续出牌（若补成胡则 over，本 seed 不胡）');
  assert.ok(anGang(g, 0, 1).ok === false, '重复/非法暗杠拒绝');
});

test('整场 AI 全自动（13 张真牌）：3 seed 局局终局、守恒、零和', () => {
  for (const seed of [501, 502, 503]) {
    const g = createGame(seed, -1);
    let guard = 0;
    while (!gameover(g) && guard++ < 30000) {
      if (g.phase === 'claim') {
        const s = g.claimPending.cur;
        const q = g.claimPending.queue.find(x => x.s === s) || {};
        doClaim(g, s, q.hu ? 'hu' : q.gang ? 'gang' : q.peng ? 'peng' : 'pass');
        continue;
      }
      if (g.phase === 'discard') {
        if (g.selfHuPending) { selfHu(g, g.turn); continue; }
        discard(g, g.turn, aiDiscard(g, g.turn));
        continue;
      }
      break;
    }
    assert.ok(gameover(g), `seed=${seed} 终局`);
    const inMelds = g.melds.flat().reduce((n, m) => n + (m.kind === 'gang' ? 4 : 3), 0);
    assert.equal(g.wall.length + g.hands.flat().length + g.discards.flat().length + inMelds, 136, '136 守恒');
    assert.equal(g.scores.reduce((a, b) => a + b, 0), 0, '零和');
  }
});

// ───────────────────────────── 德州 ─────────────────────────────

test('德州盲注计入本街：streetCommitted=[0,10,20,0]、currentBet=20、UTG=3（修复：曾全 0，BB 被迫多付）', () => {
  const t = createTable(1);
  startHand(t); // button 3→0，sb=1, bb=2, UTG=3
  assert.deepEqual(t.hand.streetCommitted, [0, 10, 20, 0]);
  assert.equal(t.hand.currentBet, 20);
  assert.equal(t.hand.toAct, 3);
  const la3 = legalActions(t, 3);
  assert.equal(la3.toCall, 20, 'UTG 跟注 20');
  const laBB = legalActions(t, 2);
  assert.equal(laBB, null, '未轮到 BB 时无动作');
});

test('BB option：全 limp 后 BB 仍可过牌/加注（修复：曾直接进翻牌）', () => {
  const t = createTable(1);
  startHand(t); // sb=1, bb=2, UTG=3
  act(t, 3, 'call'); // UTG
  act(t, 0, 'call'); // BTN
  act(t, 1, 'call'); // SB 补 10
  assert.equal(t.hand.toAct, 2, '轮到 BB');
  const la = legalActions(t, 2);
  assert.equal(la.toCall, 0, 'BB 已平齐');
  assert.equal(la.canCheck, true, 'BB 有 option');
  const r = act(t, 2, 'raise', 60);
  assert.ok(r.ok, 'BB 加注');
  assert.equal(t.hand.currentBet, 60);
  assert.equal(t.hand.toAct, 3, '重开行动 → UTG');
});

test('每街独立下注轮：翻前平齐 → flop 重置，翻牌圈可下注（修复：曾整体跳过直落摊牌）', () => {
  const t = createTable(7);
  startHand(t); // sb=1, bb=2
  for (const s of [3, 0, 1]) act(t, s, 'call');
  act(t, 2, 'check'); // BB option
  assert.equal(t.hand.street, 'flop', '进翻牌');
  assert.equal(t.hand.board.length, 3);
  assert.deepEqual(t.hand.streetCommitted, [0, 0, 0, 0], '新街投入清零');
  assert.equal(t.hand.currentBet, 0);
  assert.equal(t.hand.toAct, 1, 'SB 先行动');
  assert.equal(legalActions(t, 1).canCheck, true, '翻牌可过牌');
  act(t, 1, 'check'); act(t, 2, 'check'); act(t, 3, 'check');
  const r = act(t, 0, 'raise', 20); // BTN 下注（currentBet=0 时 raise 语义=bet）
  assert.ok(r.ok, '翻牌圈下注成立');
  assert.equal(t.hand.currentBet, 20);
  assert.equal(t.hand.toAct, 1, '其余人需应答');
});

test('短 all-in 不重开行动：未行动者保留全权、加注者不被重问（标准 NLHE）', () => {
  const t = createTable(9);
  t.stacks = [1000, 120, 1000, 1000]; // sb=1 短码 120
  startHand(t); // button 3→0, sb=1, bb=2, UTG=3；行动顺序 UTG→BTN→SB→BB
  act(t, 3, 'raise', 200); // UTG 加注 200（足额）
  act(t, 0, 'call'); // BTN 跟
  act(t, 1, 'allin'); // SB 短 all-in 120 < 200
  assert.equal(t.hand.currentBet, 200, '短 all-in 不抬高 currentBet');
  assert.equal(t.hand.allin[1], true);
  assert.equal(t.hand.toAct, 2, '轮到 BB');
  assert.equal(legalActions(t, 2).canRaise, true, '未行动者（BB）保留加注权');
  act(t, 2, 'call');
  assert.equal(t.hand.street, 'flop', '平齐收束进翻牌；加注者 UTG 未被重问（短 all-in 不重开）');
});

test('第 10 手打完才收场：10 手全打、筹码严格守恒（修复：曾发牌即 over，盲注 30 蒸发）', () => {
  const sess = holdemCreateSession(31, { totalHands: 10, rebuyLimit: 0, startStack: 1000 });
  let guard = 0;
  while (!sess.over && guard++ < 500) {
    startNextHand(sess);
    const t = sess.table;
    let k = 0;
    while (!handOver(t) && k++ < 2000) {
      const s = t.hand.toAct;
      const d = s === 0 ? { action: legalActions(t, 0).canCall ? 'call' : 'check' } : aiDecide(t, s);
      act(t, s, d.action, d.amount);
    }
  }
  assert.equal(sess.handNo, 10, '正好打满 10 手');
  const t = sess.table;
  assert.ok(t.hand && t.hand.results, '第 10 手有完整结算');
  assert.equal(t.stacks.reduce((a, b) => a + b, 0) + t.hand.committed.reduce((a, b) => a + b, 0), 4000, '4000 严格守恒');
  startNextHand(sess); // 再推进 → 收场
  assert.equal(sess.over, true, '第 10 手打完后下一次推进才 over');
  assert.ok(sess.champ >= 0 && sess.champ < 4);
});

test('AI 翻前不再 100% 弃牌：st/strength 修复后有跟注/加注行为', () => {
  let nonFold = 0, total = 0, raises = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = createTable(seed, { startStack: 500 });
    startHand(t);
    let k = 0;
    while (!handOver(t) && k++ < 500) {
      const s = t.hand.toAct;
      const d = aiDecide(t, s);
      if (t.hand.street === 'preflop') { total++; if (d.action !== 'fold') nonFold++; if (d.action === 'raise' || d.action === 'allin') raises++; }
      const r = act(t, s, d.action, d.amount);
      assert.ok(r.ok, `seed=${seed} AI 动作合法 ${d.action}`);
    }
  }
  assert.ok(total > 0, '有翻前决策');
  assert.ok(nonFold / total > 0.3, `翻前弃牌率 ${(1 - nonFold / total).toFixed(2)} < 70%`);
  assert.ok(raises > 0, '存在翻前加注');
});

// ───────────────────────────── 牛牛 ─────────────────────────────

const cc = (s, v) => ({ s, v });

test('牛牛炸弹同型比四张点数：3333+4 胜 2222+K（修复：曾比最大单张，kicker 抢权）', () => {
  const h0 = [cc('S', 2), cc('H', 2), cc('C', 2), cc('D', 2), cc('S', 13)]; // 2222+K
  const h1 = [cc('S', 3), cc('H', 3), cc('C', 3), cc('D', 3), cc('S', 4)]; // 3333+4
  const n0 = { ...niuFor(h0, [0, 1, 2]), cards: h0 };
  const n1 = { ...niuFor(h1, [0, 1, 2]), cards: h1 };
  assert.equal(n0.type, 'zhadan'); assert.equal(n1.type, 'zhadan');
  assert.ok(cmpKeyOf(n1) > cmpKeyOf(n0), '四张点数 3 > 2');
  const round = {
    seed: 1, baseBet: 10, settled: null,
    hands: [
      h0, h1,
      [cc('S', 9), cc('H', 9), cc('D', 3), cc('C', 7), cc('S', 5)],  // 无牛 max 9♠
      [cc('H', 9), cc('D', 9), cc('C', 3), cc('H', 7), cc('D', 5)]   // 无牛 max 9♥
    ],
    arr: [[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2]]
  };
  const res = settle(round);
  assert.deepEqual(res.deltas, [50, 150, -90, -110], '两两互赔：炸弹×5，2222+K 胜两侧无牛、3333+4 全胜');
  assert.equal(res.lines[0], '你(炸弹) → AI1(炸弹) 付 50', 'seat0 视角文案=你；输家名旁=输家牌型');
});

// ───────────────────────────── 掼蛋 ─────────────────────────────

const gc = (s, v, id) => ({ s, v, id: id ?? Math.random() });

test('掼蛋 play() 拒绝重复牌（修复：曾可同张冒充对子且手牌少扣）', () => {
  const card = gc('S', 6, 1);
  const m = {
    phase: 'play', turnSeat: 0, handLevel: 5,
    hands: { 0: [card, gc('H', 6, 2), gc('S', 3, 3)] },
    leaderCombo: null, passed: [], finishedOrder: [], log: []
  };
  const r = gdPlay(m, 0, [card, card]);
  assert.equal(r.ok, false, '同张两次拒绝');
  assert.equal(r.reason, 'duplicate-card');
  assert.equal(m.hands[0].length, 3, '手牌未被扣');
  const ok = gdPlay(m, 0, [card, m.hands[0][1]]);
  assert.ok(ok.ok, '真对子合法');
  assert.equal(m.hands[0].length, 1);
});

test('掼蛋双下：三游贡大 → 大贡配头游（修复：曾固定末游→头游）', () => {
  const hands = {
    0: [gc('S', 6), gc('H', 6)],   // 头游
    2: [gc('D', 7)],                // 二游
    1: [gc('S', 14), gc('H', 12)],  // 三游：贡 A（大）
    3: [gc('S', 13), gc('H', 10)]   // 末游：贡 K
  };
  const m = { humanSeat: -1, handLevel: 5, hands, lastFinish: [0, 2, 1, 3], leaderSeat: 0, pendingReturn: null, tributeInfo: null, log: [] };
  applyTribute(m);
  assert.equal(m.tributeInfo.crossed, false, '不同大不换向');
  assert.deepEqual(m.tributeInfo.acts.map(a => [a.giver, a.receiver]), [[1, 0], [3, 2]], '大贡（三游 A）→ 头游，末游 K → 二游');
  assert.equal(m.leaderSeat, 1, '贡大牌者（三游）先出');
});

test('掼蛋双下：末游贡大 → 保持末游→头游（大贡仍配头游）', () => {
  const hands = {
    0: [gc('S', 6), gc('H', 6)],
    2: [gc('D', 7)],
    1: [gc('S', 13), gc('H', 12)],  // 三游贡 K
    3: [gc('S', 14), gc('H', 10)]   // 末游贡 A（大）
  };
  const m = { humanSeat: -1, handLevel: 5, hands, lastFinish: [0, 2, 1, 3], leaderSeat: 0, pendingReturn: null, tributeInfo: null, log: [] };
  applyTribute(m);
  assert.equal(m.tributeInfo.crossed, false);
  assert.deepEqual(m.tributeInfo.acts.map(a => [a.giver, a.receiver]), [[3, 0], [1, 2]]);
  assert.equal(m.leaderSeat, 3, '贡大牌者（末游）先出');
});
