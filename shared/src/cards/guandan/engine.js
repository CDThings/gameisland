/**
 * 掼蛋对局状态机（纯逻辑，node --test 可测；AI 整场模拟也走这里）。
 *
 * 座位：0/1/2/3；队0={0,2}，队1={1,3}（对家=隔一位）。出牌逆时针 0→3→2→1→0。
 * 级数：两队各自记录；"局牌"（级牌/逢人配）= 上一局胜方（打级方）进级后的级数。
 * 升级：头游方 +3（对家二游/双下）/ +2（对家三游）/ +1（对家末游）；封顶 A。
 * 过 A：打 A 局且头游对家非末游（+2/+3）→ 该队获胜，整场结束。
 * 进贡（官方口径）：非双下仅末游→头游；双下双贡（同大则顺时针换向）；
 *       抗贡（非双下=末游持 2 大王 / 双下=合计 2 大王）→ 头游先出。
 *       先出权：抗贡→头游；单贡→末游；双贡→贡大牌者；同大→头游下家。
 *       收贡方还一张 ≤10；首局无进贡，随机一家先出。
 */

import { buildDeck, isWild } from './cards.js';
import { mulberry32, fnv1a } from '../../rng.js';
import { recognize, beats } from './combos.js';
import { pickTribute, pickReturn, canResist, tributePairs, isDoubleDown, powerOf } from './tribute.js';

export const PLAY_ORDER = [0, 3, 2, 1]; // 逆时针
export function partnerOf(i) { return i ^ 2; }
export function teamOf(i) { return i % 2 === 0 ? 0 : 1; }
export function nextSeat(i) { return PLAY_ORDER[(PLAY_ORDER.indexOf(i) + 1) % 4]; }
export function activeSeats(m) { return [0, 1, 2, 3].filter(s => !m.finishedOrder.includes(s)); }

function advance(m, seat) {
  let s = nextSeat(seat);
  while (m.finishedOrder.includes(s)) s = nextSeat(s);
  return s;
}

function removeFrom(hand, card) {
  const ix = hand.findIndex(c => c.id === card.id);
  if (ix >= 0) hand.splice(ix, 1);
}

/** seed 归一化：任何输入（含 undefined/NaN/对象/字符串/负数）→ 安全 uint31。
 *  修复：曾把 DOM 事件对象/NaN 直接当 seed 用——`{} >>> 0` 与 `NaN >>> 0` 均为 0，
 *  导致每次点击「新开一局」都得到同一副牌（seed=0），看起来像"游戏没开始/卡住"。 */
export function sanitizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.floor(seed) >>> 0) & 0x7fffffff;
  if (typeof seed === 'string' && seed.length) return fnv1a(seed) & 0x7fffffff;
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
}

/** 新建整场（从 2 级打到过 A）。seed 可复现；humanSeat>=0 时该座位的"还贡"需手动完成（phase='tribute'）。 */
export function createMatch(seed, humanSeat = -1) {
  const m = {
    seed: sanitizeSeed(seed),
    humanSeat,            // 人类座位（-1=纯 AI 模拟）
    teamLevels: [2, 2],
    leaderTeam: 0,          // 打级方（下一局级数以其为准）
    handLevel: 2,           // 本局级牌/逢人配点值（2..14，A=14）
    handNo: 0,
    phase: 'new',          // new | tribute | play | handEnd | matchOver
    matchOver: false,
    winnerTeam: null,
    lastFinish: null,      // [头游, 二游, 三游, 末游]
    lastAdv: 0,
    hands: [], turnSeat: -1,
    trickOwner: -1, leaderCombo: null, passed: [],
    finishedOrder: [],
    log: [],
    firstLeader: -1,
    leaderSeat: -1,
    tributeInfo: null,
    pendingReturn: null,   // {to: 座位} 人类（humanSeat）作为收贡方待还贡
    totalHands: 0,
    teamWins: [0, 0]
  };
  m.rng = mulberry32(m.seed); // 必须用归一化后的 m.seed（与 serialize/restore 口径一致，首副也随存档 seed 可复现）
  m.firstLeader = Math.floor(m.rng() * 4);
  startHand(m);
  return m;
}

/** 开新副牌：发牌 →（第 2 副起）进贡/抗贡 → 头游先出（首局随机家）。
 *  若人类（humanSeat）是收贡方（需还贡），进入 phase='tribute' 等待手动还贡。 */
export function startHand(m) {
  m.handNo++;
  m.totalHands = m.handNo;
  // 局牌 = 打级方（上一局胜方）进级后的级数
  m.handLevel = m.handNo === 1 ? 2 : Math.min(14, m.teamLevels[m.leaderTeam]);
  // 发牌
  m.rng = mulberry32((m.seed ^ Math.imul(m.handNo, 0x9E3779B1)) >>> 0);
  const deck = buildDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(m.rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  m.hands = [deck.slice(0, 27), deck.slice(27, 54), deck.slice(54, 81), deck.slice(81, 108)];
  m.finishedOrder = [];
  m.passed = [];
  m.leaderCombo = null;
  m.trickOwner = -1;
  m.log = [];
  m.tributeInfo = null;
  m.pendingReturn = null;
  m.leaderSeat = m.handNo === 1 ? m.firstLeader : m.lastFinish[0]; // 头游先出
  if (m.handNo > 1) applyTribute(m);
  if (m.pendingReturn) { m.phase = 'tribute'; m.turnSeat = -1; }
  else { m.phase = 'play'; m.turnSeat = m.leaderSeat; }
  m.log.push({ type: 'hand', no: m.handNo, level: m.handLevel, leader: m.leaderSeat });
  return m;
}

/** 进贡（官方先出权）：
 *  - 抗贡 → 上游者（头游）先出；
 *  - 单贡（非双下，仅末游→头游）→ 下游者（末游）先出；
 *  - 双贡（双下）→ 贡大牌者先出；
 *  - 双贡同大 → 顺时针换向进贡（三游→头游、末游→二游），由上游者（头游）的下家先出。
 *  还贡：AI 自动（最小 ≤10）；人类（humanSeat）作为收贡方时留待手动 completeReturn。 */
export function applyTribute(m) {
  const fo = m.lastFinish;
  const dd = isDoubleDown(fo);
  if (canResist(fo, m.hands)) {
    m.tributeInfo = { resisted: true, doubleDown: dd, crossed: false, acts: [], firstSeat: fo[0] };
    m.leaderSeat = fo[0]; // 上游者（头游）先出
    m.log.push({ type: 'resist' });
    return;
  }
  // 双下：两贡比大小——大贡配头游、小贡配二游（官方"收贡大者拿大贡"，修复：曾固定末游→头游）；同大 → 顺时针换向配对
  let crossed = false;
  let pairs = tributePairs(fo, false);
  let tributes = pairs.map(({ giver }) => pickTribute(m.hands[giver], m.handLevel));
  if (dd) {
    const t4 = tributes[0], t3 = tributes[1]; // 默认配对：[0]=末游贡 [1]=三游贡
    const p4 = powerOf(t4, m.handLevel);
    const p3 = powerOf(t3, m.handLevel);
    if (p3 === p4) {
      crossed = true;
      pairs = tributePairs(fo, true);
      tributes = pairs.map(({ giver }) => pickTribute(m.hands[giver], m.handLevel));
    } else if (p3 > p4) {
      pairs = [{ giver: fo[2], receiver: fo[0] }, { giver: fo[3], receiver: fo[1] }]; // 三游贡大 → 三游→头游、末游→二游
      tributes = [t3, t4];
    }
  }
  const acts = [];
  let pending = null;
  pairs.forEach(({ giver, receiver }, i) => {
    const t = tributes[i];
    if (!t) return;
    removeFrom(m.hands[giver], t);
    m.hands[receiver].push(t);
    let rr = null;
    if (receiver === m.humanSeat) {
      pending = { to: giver }; // 人类收贡 → 手动还贡
    } else {
      rr = pickReturn(m.hands[receiver], m.handLevel);
      if (rr) { removeFrom(m.hands[receiver], rr); m.hands[giver].push(rr); }
    }
    acts.push({ giver, receiver, tribute: t, ret: rr });
  });
  // 官方先出权
  let firstSeat;
  if (!dd) {
    firstSeat = fo[3]; // 单贡：下游者（末游）先出
  } else if (!crossed) {
    const big = acts.reduce((a, b) => (powerOf(b.tribute, m.handLevel) > powerOf(a.tribute, m.handLevel) ? b : a));
    firstSeat = big.giver; // 双贡：贡大牌者先出
  } else {
    firstSeat = nextSeat(fo[0]); // 同大：上游者（头游）的下家
  }
  m.leaderSeat = firstSeat;
  m.tributeInfo = { resisted: false, doubleDown: dd, crossed, acts, firstSeat };
  m.pendingReturn = pending;
  m.log.push({ type: 'tribute', acts, firstSeat });
}

/** 手动还贡是否合法：优先还"非逢人配的 ≤10 自然牌"；没有则还最小的一张。 */
export function validReturn(m, card) {
  if (m.phase !== 'tribute' || !m.pendingReturn) return false;
  const hand = m.hands[m.humanSeat];
  if (!card || !hand.some(c => c.id === card.id)) return false;
  if (card.s === 'J' || isWild(card, m.handLevel)) return false; // 王/逢人配不还
  const nonWild = hand.filter(c => c.s !== 'J' && !isWild(c, m.handLevel));
  const hasLe10 = nonWild.some(c => c.v <= 10);
  if (hasLe10) return card.v <= 10;
  const p = c => (c.s === 'J' ? (c.v === 'B' ? 15 : 14) : c.v === m.handLevel ? 13 : c.v - 2);
  return p(card) === Math.min(...nonWild.map(p));
}

/** 完成人类的手动还贡 → 进入出牌（头游先出）。 */
export function completeReturn(m, card) {
  if (!validReturn(m, card)) return { ok: false, reason: 'bad-return' };
  const to = m.pendingReturn.to;
  removeFrom(m.hands[m.humanSeat], card);
  m.hands[to].push(card);
  const act = (m.tributeInfo?.acts || []).find(a => a.receiver === m.humanSeat);
  if (act) act.ret = card;
  m.log.push({ type: 'return', from: m.humanSeat, to, card });
  m.pendingReturn = null;
  m.phase = 'play';
  m.turnSeat = m.leaderSeat;
  return { ok: true };
}

/** 跟牌是否合法（压过当前牌）。 */
export function canFollow(m, cards) {
  if (!m.leaderCombo) return false;
  const c = recognize(cards, m.handLevel);
  return !!c && beats(c, m.leaderCombo);
}
/** 首出/新轮是否合法。 */
export function canLead(m, cards) {
  return recognize(cards, m.handLevel) !== null;
}

/** 出牌。返回 {ok, combo?}。 */
export function play(m, seat, cards) {
  if (m.phase !== 'play' || m.turnSeat !== seat) return { ok: false, reason: 'not-your-turn' };
  if (!cards || !cards.length) return { ok: false, reason: 'empty' };
  const ids = new Set(cards.map(c => c.id));
  if (ids.size !== cards.length) return { ok: false, reason: 'duplicate-card' }; // 修复：曾建 Set 未用，同一张牌传两次可冒充对子且手牌只扣一张
  if (!cards.every(c => m.hands[seat].some(h => h.id === c.id))) return { ok: false, reason: 'not-in-hand' };
  const c = recognize(cards, m.handLevel);
  if (!c) return { ok: false, reason: 'not-a-combo' };
  if (m.leaderCombo && !beats(c, m.leaderCombo)) return { ok: false, reason: 'too-small' };
  cards.forEach(x => removeFrom(m.hands[seat], x));
  m.trickOwner = seat;
  m.leaderCombo = c;
  m.passed = [];
  m.log.push({ type: 'play', seat, cards, combo: c });
  if (m.hands[seat].length === 0) m.finishedOrder.push(seat);
  if (m.finishedOrder.length === 3) return endHand(m);
  m.turnSeat = advance(m, seat);
  return { ok: true, combo: c };
}

/** 过牌（仅跟牌轮可用；首出必须出）。 */
export function pass(m, seat) {
  if (m.phase !== 'play' || m.turnSeat !== seat) return { ok: false, reason: 'not-your-turn' };
  if (!m.leaderCombo) return { ok: false, reason: 'must-lead' };
  m.passed.push(seat);
  m.log.push({ type: 'pass', seat });
  const others = activeSeats(m).filter(s => s !== m.trickOwner).length;
  if (m.passed.length >= others) {
    // 一圈全过：轮结束。牌主未出完 → 牌主再领出；牌主已出完 → 官方"接风"：出牌权归牌主的对家
    //（对家也已出完的双下后余局则顺延到下一有牌者，官方文本未覆盖此细节）
    let leader = m.trickOwner;
    if (m.finishedOrder.includes(m.trickOwner)) {
      const p = partnerOf(m.trickOwner);
      leader = m.finishedOrder.includes(p) ? advance(m, m.trickOwner) : p;
    }
    m.trickOwner = leader;
    m.leaderCombo = null;
    m.passed = [];
    m.log.push({ type: 'trick-end', leader });
    m.turnSeat = leader;
  } else {
    m.turnSeat = advance(m, seat);
  }
  return { ok: true };
}

/** 升级计算（纯函数，便于单测）：head-you 方 +3/+2/+1（对家二游/三游/末游），封顶 A。
 *  passA = 本局过 A：局牌为 A 且打级方即胜方且 +2/+3（对家非末游）。 */
export function computeUpgrade(finishOrder, teamLevels, handLevel, prevLeader) {
  const f1 = finishOrder[0];
  const wTeam = teamOf(f1);
  const pIdx = finishOrder.indexOf(partnerOf(f1)); // 1=二游 2=三游 3=末游
  const adv = pIdx === 1 ? 3 : pIdx === 2 ? 2 : 1;
  const newLevels = teamLevels.map((l, i) => (i === wTeam ? Math.min(14, l + adv) : l));
  const passA = handLevel === 14 && prevLeader === wTeam && adv >= 2;
  return { wTeam, adv, newLevels, passA };
}

/** 三名出完 → 末游定局；升级/过 A；整场可能结束。 */
function endHand(m) {
  const last = activeSeats(m)[0];
  m.finishedOrder.push(last);
  m.lastFinish = [...m.finishedOrder]; // [头游, 二游, 三游, 末游]
  const prevLeader = m.leaderTeam; // 本局打级方（局牌=其级数）
  const up = computeUpgrade(m.lastFinish, m.teamLevels, m.handLevel, prevLeader);
  m.lastAdv = up.adv;
  m.teamLevels = up.newLevels;
  m.leaderTeam = up.wTeam;
  m.teamWins[up.wTeam]++;
  if (up.passA) {
    m.matchOver = true;
    m.winnerTeam = up.wTeam;
    m.phase = 'matchOver';
  } else {
    m.phase = 'handEnd';
  }
  m.log.push({ type: 'hand-end', finish: m.lastFinish, adv: up.adv, winnerTeam: up.wTeam, matchOver: m.matchOver });
  return { ok: true, finish: m.lastFinish };
}

/** 序列化/恢复（localStorage 单机存档）。 */
export function serialize(m) {
  const { passed, ...rest } = m;
  return JSON.stringify({ ...rest, passed: [...passed] });
}
export function restore(json) {
  const m = JSON.parse(json);
  // 边界检查：存档结构不完整/被篡改时抛错（调用方捕获后降级为新开局，避免半残状态卡死界面）
  if (!m || typeof m !== 'object') throw new Error('bad-save');
  if (!Array.isArray(m.hands) || m.hands.length !== 4 || !m.hands.every(h => Array.isArray(h))) throw new Error('bad-save');
  if (!['new', 'tribute', 'play', 'handEnd', 'matchOver'].includes(m.phase)) throw new Error('bad-save');
  if (!Array.isArray(m.teamLevels) || m.teamLevels.length !== 2) throw new Error('bad-save');
  m.rng = mulberry32(sanitizeSeed(m.seed));
  return m;
}

export { isWild };
