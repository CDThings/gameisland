/**
 * 德州扑克（Limit 风格下注的单机版）纯逻辑：1 人 + 3 AI（4 人桌）。
 *  - 52 张；底牌 2 + 公共牌 5（翻 3 / 转 1 / 河 1）。
 *  - 牌型：皇家同花顺(9) > 同花顺(8) > 四条(7) > 葫芦(6) > 同花(5) > 顺子(4) > 三条(3) > 两对(2) > 一对(1) > 高牌(0)；A2345 为最小顺。
 *  - 下注：小盲/大盲；动作 过牌/跟注/加注/弃牌/全下；一轮投入平齐 → 下一街；全下平齐 → 直接发完摊牌。
 *  - 摊牌按投入分层构造边池，逐池比牌，平分；筹码全程守恒。
 */
import { rollChips, applyChip } from './meta.js';

export const HAND_CN = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺', '皇家同花顺'];

export function buildDeck() {
  const d = []; let id = 0;
  for (const s of ['S', 'H', 'C', 'D']) for (let v = 2; v <= 14; v++) d.push({ s, v, id: id++ });
  return d;
}

/** 5 张精确评估 → {rank, tb:[...]}（tb 字典序越大越强）。 */
export function evaluate5(cs) {
  const vs = cs.map(c => c.v).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  const cnt = {}; vs.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
  const groups = Object.entries(cnt).map(([v, n]) => ({ v: +v, n })).sort((a, b) => b.n - a.n || b.v - a.v);
  const uniq = groups.map(g => g.v);
  const straightHigh = (() => {
    const set = new Set(vs);
    if (set.has(14) && set.has(5) && set.has(4) && set.has(3) && set.has(2)) return 5; // A2345 轮子
    for (let hi = 14; hi >= 6; hi--) if (set.has(hi) && set.has(hi - 1) && set.has(hi - 2) && set.has(hi - 3) && set.has(hi - 4)) return hi;
    return 0;
  })();
  if (flush && straightHigh) return { rank: straightHigh === 14 ? 9 : 8, tb: [straightHigh] };
  if (groups[0].n === 4) return { rank: 7, tb: [groups[0].v, groups[1].v] };
  if (groups[0].n === 3 && groups[1].n === 2) return { rank: 6, tb: [groups[0].v, groups[1].v] };
  if (flush) return { rank: 5, tb: vs };
  if (straightHigh) return { rank: 4, tb: [straightHigh] };
  if (groups[0].n === 3) return { rank: 3, tb: [groups[0].v, ...uniq.slice(1)] };
  if (groups[0].n === 2 && groups[1].n === 2) return { rank: 2, tb: [groups[0].v, groups[1].v, groups[2].v] };
  if (groups[0].n === 2) return { rank: 1, tb: [groups[0].v, ...uniq.slice(1)] };
  return { rank: 0, tb: vs };
}

/** 7 张取最优 5 张（C(7,5)=21 组合枚举）。 */
export function evaluate7(cards7) {
  let best = null;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++)
    for (let d = c + 1; d < 6; d++) for (let e = d + 1; e < 7; e++) {
      const ev = evaluate5([cards7[a], cards7[b], cards7[c], cards7[d], cards7[e]]);
      if (!best || cmpEval(ev, best) > 0) best = ev;
    }
  return best;
}
/** n 张（5≤n≤7）取最优 5 张：翻牌 5 张 / 转牌 6 张 / 河牌 7 张（AI 各街决策用）。 */
export function evaluateN(cs) {
  if (cs.length === 5) return evaluate5(cs);
  if (cs.length === 7) return evaluate7(cs);
  if (cs.length === 6) {
    let best = null;
    for (let skip = 0; skip < 6; skip++) {
      const ev = evaluate5(cs.filter((_, i) => i !== skip));
      if (!best || cmpEval(ev, best) > 0) best = ev;
    }
    return best;
  }
  throw new Error('evaluateN: 需要 5~7 张');
}
export function cmpEval(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const n = Math.max(a.tb.length, b.tb.length);
  for (let i = 0; i < n; i++) { const x = a.tb[i] || 0, y = b.tb[i] || 0; if (x !== y) return x - y; }
  return 0;
}
export function evalText(ev) { return HAND_CN[ev.rank]; }

/** 按投入分层构造边池。 */
export function splitPots(committed) {
  const levels = [...new Set(committed.filter(c => c > 0))].sort((a, b) => a - b);
  let prev = 0; const pots = [];
  for (const lv of levels) {
    const amount = committed.reduce((n, c) => n + Math.max(0, Math.min(c, lv) - prev), 0);
    pots.push({ amount, eligible: committed.map((c, i) => [i, c]).filter(([, c]) => c >= lv).map(([i]) => i) });
    prev = lv;
  }
  return pots;
}

export function createTable(seed, opts = {}) {
  return {
    seed: seed >>> 0, rng: null, rngS: null, // rngS=可序列化 rng 状态（v1.50：存档后"继续上局"AI 重放精确）
    stacks: [opts.startStack ?? 500, opts.startStack ?? 500, opts.startStack ?? 500, opts.startStack ?? 500],
    button: 3, smallBlind: opts.smallBlind ?? 10, bigBlind: opts.bigBlind ?? 20,
    handNo: 0, hand: null, humanSeat: opts.humanSeat ?? 0, history: [], matchOver: false
  };
}

function nextAlive(t, from) { let s = from; for (let k = 0; k < 4; k++) { s = (s + 1) % 4; if (t.stacks[s] > 0) return s; } return from; }
function activeSeats(t) { return [0, 1, 2, 3].filter(i => !t.hand.folded[i]); }
function firstToActPostflop(t) { let s = t.button; for (let k = 0; k < 4; k++) { s = (s + 1) % 4; if (!t.hand.folded[s] && !t.hand.allin[s]) return s; } return -1; }

/** 开一手：移庄→盲注→发牌→preflop。 */
export function startHand(t) {
  t.handNo++;
  // v1.50：rng 状态存为纯数据 t.rngS（mulberry32 同口径步进）→ JSON 可序列化，
  // "继续上局"后 AI 决策流与未存档局逐字节一致（旧实现 restore 按起手重导 → 中途存档续打 AI 漂移）。
  t.rngS = (t.seed ^ Math.imul(t.handNo, 0x9E3779B1)) >>> 0;
  t.rng = () => stepRng(t);
  if (t.stacks.filter(s => s > 0).length < 2) { t.hand = null; t.matchOver = true; return t; }
  const deck = buildDeck();
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(t.rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  t.button = nextAlive(t, t.button);
  // v1.50：NLHE 单挑口径——button=SB、对家=BB（≥3 人时 button 左手=SB）
  const aliveN = t.stacks.filter(s => s > 0).length;
  const sb = aliveN === 2 ? t.button : nextAlive(t, t.button);
  const bb = nextAlive(t, sb);
  const committed = [0, 0, 0, 0];
  const foldedAtStart = t.stacks.map(s => s <= 0); // 破产者本手不参与（须在扣盲注前判定）
  const post = (seat, amt) => { const pay = Math.min(amt, t.stacks[seat]); t.stacks[seat] -= pay; committed[seat] += pay; };
  post(sb, t.smallBlind); post(bb, t.bigBlind);
  t.hand = {
    deck, hole: [deck.slice(0, 2), deck.slice(2, 4), deck.slice(4, 6), deck.slice(6, 8)],
    board: [], deckPos: 8,
    // 盲注计入本街已投（修复：曾 streetCommitted 全 0 → BB 被迫多付 20、SB 多付 10）
    committed, streetCommitted: committed.slice(),
    folded: foldedAtStart, allin: t.stacks.map(s => s === 0),
    // 本街是否已自愿行动：BB option（跟平后仍可 check/raise）与短 all-in 不重开行动都靠它
    acted: [false, false, false, false],
    street: 'preflop', toAct: nextAlive(t, bb),
    currentBet: Math.max(...committed), minRaise: t.bigBlind, // 实际投出的最大盲注（BB 短筹码时以实投为准）
    sb, bb, results: null
  };
  t.history.push({ type: 'hand', handNo: t.handNo, button: t.button });
  return t;
}
/** mulberry32 单步（状态存 t.rngS 纯数据 → 可序列化重放；与 rng.js 的 mulberry32 流逐字节一致）。 */
function stepRng(t) {
  t.rngS = (t.rngS + 0x6d2b79f5) | 0;
  let x = t.rngS;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** 该座位本街是否还需行动：未弃未全下有筹码，且（投入未平齐 或 尚未自愿行动过）。 */
function needsAct(t, s) {
  const h = t.hand;
  return !h.folded[s] && !h.allin[s] && t.stacks[s] > 0 && (h.streetCommitted[s] < h.currentBet || !h.acted[s]);
}
function streetDone(t) {
  const h = t.hand;
  const contenders = activeSeats(t).filter(i => !h.allin[i] && t.stacks[i] > 0);
  if (!contenders.length) return true;
  // 修复：曾只比 streetCommitted===currentBet → 新街全 0 恒真，翻牌后下注轮被整体跳过；
  // 现在还必须「每人都行动过」，BB option 与每条街首轮下注由此保证。
  return contenders.every(i => !needsAct(t, i));
}

function dealBoard(t, n) { for (let k = 0; k < n; k++) t.hand.board.push(t.hand.deck[t.hand.deckPos++]); }

function nextStreet(t) {
  const h = t.hand;
  // v1.50：记录"本街推进前"的下注街——全下摊牌(runout)时 results.street 应是实际最后下注的街，
  // 而非推进后的街（曾翻牌全下 runout 被记成转牌/河牌，HUD 街位与 chip 上下文误报）
  const betStreet = h.street;
  h.streetCommitted = [0, 0, 0, 0]; h.currentBet = 0; h.minRaise = t.bigBlind;
  h.acted = [false, false, false, false];
  if (h.street === 'preflop') { h.street = 'flop'; dealBoard(t, 3); }
  else if (h.street === 'flop') { h.street = 'turn'; dealBoard(t, 1); }
  else if (h.street === 'turn') { h.street = 'river'; dealBoard(t, 1); }
  else { showdown(t, betStreet); return; }
  const runout = activeSeats(t).every(i => h.allin[i] || t.stacks[i] === 0);
  if (runout) { showdown(t, betStreet); return; }
  h.toAct = firstToActPostflop(t);
  if (h.toAct === -1) { if (h.street === 'river') showdown(t, betStreet); else nextStreet(t); }
}

export function legalActions(t, seat) {
  const h = t.hand; if (!h || h.results || h.toAct !== seat) return null;
  const toCall = Math.min(Math.max(0, h.currentBet - h.streetCommitted[seat]), t.stacks[seat]);
  const raiseMax = h.streetCommitted[seat] + t.stacks[seat];
  return {
    fold: true, canCheck: toCall <= 0, canCall: toCall > 0, toCall,
    // 标准 NLHE 短 all-in 口径：短 all-in 不重开"已行动者"的加注权（acted 保留）；
    // 足额加注会重置所有人的 acted → 重新可加注。
    canRaise: raiseMax > h.currentBet && !h.acted[seat],
    minRaiseTo: Math.min(h.currentBet + h.minRaise, raiseMax), raiseMax,
    allin: t.stacks[seat] > 0
  };
}

function award(t, winner) {
  const h = t.hand;
  const total = h.committed.reduce((a, b) => a + b, 0);
  t.stacks[winner] += total;
  h.results = { kind: 'fold-win', winner, pots: [{ amount: total, winners: [winner] }], board: h.board.slice(), street: h.street };
  h.committed = [0, 0, 0, 0];
  t.history.push({ type: 'fold-win', winner, total });
}

/** 玩家/AI 动作。action: fold|check|call|raise|allin；amount=本街加注到的总额（越界拒绝，不再静默钳位）。 */
export function act(t, seat, action, amount) {
  const h = t.hand; if (!h || h.results || h.toAct !== seat) return { ok: false, reason: 'not-your-turn' };
  const la = legalActions(t, seat);
  if (action === 'fold') { h.folded[seat] = true; h.acted[seat] = true; t.history.push({ type: 'fold', seat }); }
  else if (action === 'check') { if (!la.canCheck) return { ok: false, reason: 'cannot-check' }; h.acted[seat] = true; t.history.push({ type: 'check', seat }); }
  else if (action === 'call') {
    if (!la.canCall) return { ok: false, reason: 'cannot-call' };
    const pay = Math.min(la.toCall, t.stacks[seat]);
    t.stacks[seat] -= pay; h.committed[seat] += pay; h.streetCommitted[seat] += pay;
    if (t.stacks[seat] === 0) h.allin[seat] = true;
    h.acted[seat] = true;
    t.history.push({ type: 'call', seat, pay });
  } else if (action === 'raise' || action === 'allin') {
    if (action === 'raise' && !la.canRaise) return { ok: false, reason: 'cannot-raise' };
    // v1.50：allin 无加注权时（raiseMax ≤ 当前下注）本质是全下=跟平 → 按 call 记账/记日志，避免误导"全下"
    let raiseTo;
    if (action === 'allin') raiseTo = la.raiseMax;
    else if (amount == null) raiseTo = la.minRaiseTo;
    else if (amount < la.minRaiseTo || amount > la.raiseMax) return { ok: false, reason: 'bad-amount' };
    else raiseTo = amount;
    const real = raiseTo - h.streetCommitted[seat];
    t.stacks[seat] -= real; h.committed[seat] += real; h.streetCommitted[seat] = raiseTo;
    if (raiseTo > h.currentBet) {
      const inc = raiseTo - h.currentBet;
      // 足额加注（增量 ≥ minRaise）→ 重开所有人行动（可反加）；短 all-in → 已行动者只能跟/弃
      if (inc >= h.minRaise) { h.minRaise = inc; for (let i = 0; i < 4; i++) h.acted[i] = false; }
      h.currentBet = raiseTo;
    }
    h.acted[seat] = true;
    if (t.stacks[seat] === 0) h.allin[seat] = true;
    const logType = action === 'allin' ? (la.canRaise && raiseTo > h.currentBet ? 'allin' : 'call') : 'raise';
    t.history.push({ type: logType, seat, to: raiseTo, pay: real });
  } else return { ok: false, reason: 'unknown-action' };
  const alive = activeSeats(t);
  if (alive.length === 1) { award(t, alive[0]); return { ok: true, over: true }; }
  if (streetDone(t)) {
    if (h.street === 'river') showdown(t); else nextStreet(t);
    return { ok: true };
  }
  let s = seat;
  for (let k = 0; k < 4; k++) {
    s = (s + 1) % 4;
    if (needsAct(t, s)) { h.toAct = s; return { ok: true }; }
  }
  if (h.street === 'river') showdown(t); else nextStreet(t);
  return { ok: true };
}

/** 摊牌：分层边池逐池比牌。betStreet=v1.50 实际最后下注街（runout 时传推进前那条街；缺省=h.street）。 */
function showdown(t, betStreet) {
  const h = t.hand;
  while (h.board.length < 5) dealBoard(t, 1);
  const pots = splitPots(h.committed);
  const results = { kind: 'showdown', pots: [], board: h.board.slice(), shows: [] };
  for (const p of pots) {
    const alive = p.eligible.filter(i => !h.folded[i]);
    const cands = alive.length ? alive : p.eligible; // 兜底：该层全部弃牌 → 按投入归还，不蒸发
    const evals = cands.map(i => ({ i, ev: evaluate7([...h.hole[i], ...h.board]) }));
    evals.sort((a, b) => cmpEval(b.ev, a.ev));
    const best = evals[0].ev;
    const winners = evals.filter(e => cmpEval(e.ev, best) === 0).map(e => e.i);
    // 平分余数给按钮左手第一位（修复：曾固定给座位号最小的赢家）
    winners.sort((a, b) => ((a - t.button + 4) % 4) - ((b - t.button + 4) % 4));
    const share = Math.floor(p.amount / winners.length);
    winners.forEach((w, k) => { t.stacks[w] += share + (k === 0 ? p.amount - share * winners.length : 0); });
    results.pots.push({ amount: p.amount, winners, hand: evalText(best) });
  }
  results.shows = activeSeats(t).map(i => ({ seat: i, text: evalText(evaluate7([...h.hole[i], ...h.board])) }));
  results.street = betStreet !== undefined ? betStreet : h.street;
  h.results = results;
  h.committed = [0, 0, 0, 0];
  t.history.push({ type: 'showdown', pots: results.pots });
}

export function handOver(t) { return !t.hand || !!t.hand.results; }

/**
 * v1.31 底池/边池构成说明（掼蛋"信息密度"参照）：把 splitPots 的边池拆解包装成展示结构。
 * 全下多层时一池拆多池（各层 eligible=投到该层及以上的座）；摊牌后 committed 清零 → 返回 []。
 * @returns Array<{ potNo, amount, eligible:number[], isMain }>（按层升序，最后一层=主池）
 */
export function potBreakdown(t) {
  const h = t && t.hand;
  if (!h) return [];
  return splitPots(h.committed)
    .filter(p => p.amount > 0)
    .map((p, i, arr) => ({ potNo: i + 1, amount: p.amount, eligible: p.eligible, isMain: i === arr.length - 1 }));
}

/**
 * v1.25 当前轮提示（对齐掼蛋 turn-hint / 座位高亮）：纯函数，按整场 session 给
 * { activeSeat, kind }。kind ∈ your-turn(activeSeat=humanSeat) | ai-turn |
 * settling(本手已摊/待 startNextHand) | done(整场结束) | idle。
 */
export function turnHint(sess) {
  if (!sess) return { activeSeat: -1, kind: 'idle' };
  if (sess.over) return { activeSeat: -1, kind: 'done' };
  const t = sess.table;
  if (!t || handOver(t)) return { activeSeat: -1, kind: 'settling' };
  const seat = t.hand ? t.hand.toAct : -1;
  if (seat == null || seat < 0 || seat > 3) return { activeSeat: -1, kind: 'settling' };
  return { activeSeat: seat, kind: seat === t.humanSeat ? 'your-turn' : 'ai-turn' };
}

/**
 * v1.36 整场态势（掼蛋"级牌进度/打级方"的德州等价物）：手数进度 + 领先者（筹码最高）+ 领先差距。
 * 纯函数，关系可单测（leader=argmax stacks、gap=一/二名差、progress=手数/总手）。
 * @returns {{ handNo, totalHands, progress, leader, leaderGap, allOut } | null}
 */
export function matchStanding(sess) {
  const t = sess && sess.table;
  if (!t || !t.stacks) return null;
  const st = t.stacks;
  let leader = 0;
  for (let i = 1; i < st.length; i++) if (st[i] > st[leader]) leader = i;
  const leaderGap = st[leader] - Math.max(...st.filter((_, i) => i !== leader));
  return {
    handNo: sess.handNo,
    totalHands: sess.totalHands,
    progress: Math.min(1, (sess.handNo || 0) / (sess.totalHands || 1)),
    leader,
    leaderGap, // 领先差距=领跑者-次高（唯一领先者时为 0）
    allOut: st.filter((x) => x > 0).length <= 1, // 全灭（只剩 1 人有筹码）
    over: !!sess.over,
    champ: sess.champ,
  };
}

/**
 * v1.29 自动打完一手（掼蛋 S.auto 的共享可测核心）：所有座位（含人类）按 aiDecide 决策
 * （难度 level），确定性（走 t.rng）。到本手摊牌/定胜负（handOver）为止。返回 table。
 */
export function autoPlayHand(t, level = 1) {
  let g = 0;
  while (!handOver(t) && g++ < 1000) {
    const s = t.hand.toAct;
    const d = aiDecide(t, s, level);
    act(t, s, d.action, d.amount);
  }
  return t;
}
/** 自动打完整场（totalHands 手 + rebuy）：startNextHand → autoPlayHand，直到 sess.over。 */
export function autoPlayMatch(sess, level = 1) {
  let guard = 0;
  while (!sess.over && guard++ < 200) {
    startNextHand(sess);
    autoPlayHand(sess.table, level);
  }
  return sess;
}

/**
 * v1.30 动作提示（对齐掼蛋"提示"）：给人类座位一个可读的最优动作建议——
 * 取强档 AI（level）的决策，包装成人话文案。纯函数（action/amount 来自 aiDecide，text 可单测）。
 * @returns {{ action, amount?, text }}
 */
export function actionHint(t, seat, level = 2) {
  const d = aiDecide(t, seat, level);
  let text;
  if (d.action === 'fold') text = '建议弃牌（牌力偏弱，不值得投入）';
  else if (d.action === 'check') text = '建议过牌（先观察，不额外投筹码）';
  else if (d.action === 'call') text = '建议跟注';
  else if (d.action === 'raise') text = `建议加注到 ${d.amount}（价值 / 施压）`;
  else text = '—';
  return { action: d.action, amount: d.amount, text };
}

/**
 * v1.32 加注档位建议（掼蛋"信息密度"参照）：可加注时给推荐档位（最小 / 半池 / 底池），
 * 每档"加注到"金额钳位到合法区间 [minRaiseTo, raiseMax] 并去重。纯函数，金额可单测（区间合法+非递减）。
 * @returns {{ toCall, canRaise, minRaise?, maxRaise?, ladder: {key,label,amount}[] } | null}
 */
export function raiseOptions(t, seat) {
  const h = t && t.hand;
  const la = legalActions(t, seat);
  if (!h || !la) return null;
  if (!la.canRaise) return { toCall: la.toCall, canRaise: false, ladder: [] };
  const potNow = h.committed.reduce((a, b) => a + b, 0);
  const lo = la.minRaiseTo, hi = la.raiseMax;
  const clamp = (x) => Math.max(lo, Math.min(hi, x));
  const raw = [
    { key: 'min', label: '最小', amount: lo },
    { key: 'half', label: '半池', amount: clamp(h.currentBet + Math.floor(potNow / 2)) },
    { key: 'pot', label: '底池', amount: clamp(h.currentBet + potNow) },
  ];
  const ladder = [];
  for (const o of raw) if (!ladder.some((x) => x.amount === o.amount)) ladder.push(o);
  return { toCall: la.toCall, canRaise: true, minRaise: lo, maxRaise: hi, ladder };
}

/**
 * v1.35 手牌牌力提示（对齐掼蛋"牌型识别/报牌"）：把人类当前 7/6/5 张（2 洞牌 + 公共牌）组合
 * 评成牌型 + 强度档（复用 evaluateN），翻牌前不足 5 张→ready:false。纯函数，牌型可单测。
 * @returns {{ ready, rank?, hand?, tier?, label?, text? }}
 */
export function handStrength(t, seat) {
  const h = t && t.hand;
  if (!h) return { ready: false };
  const cards = [...(h.hole?.[seat] || []), ...(h.board || [])];
  if (cards.length < 5) return { ready: false };
  const ev = evaluateN(cards);
  const r = ev.rank;
  const tier = r >= 9 ? 'nuts' : r >= 7 ? 'strong2' : r >= 5 ? 'strong' : r >= 3 ? 'mid' : r >= 1 ? 'weak' : 'veryweak';
  const label = { nuts: '坚果', strong2: '极强', strong: '强', mid: '中上', weak: '偏弱', veryweak: '弱' }[tier];
  return { ready: true, rank: r, hand: HAND_CN[r], tier, label, text: `你的手牌：${HAND_CN[r]}（${label}）` };
}

/**
 * AI 决策 v3（v1.23 策略层，v1.53 扩五档）：难度五档 + 确定性（决策只依赖 t.rng，可重放）。
 *   level=1（默认）= 现有 v2 行为逐字节不变（回归保护）；
 *   level=0 弱：弃牌率更高、几乎不偷牌、加注尺度小；
 *   level=2 强：更松、价值加注更大、偷牌更多；
 *   level=3 地域：松凶"地方局"——加注 1.0 底池、偷牌率 0.65、中牌（14 分起）速 all-in；
 *   level=4 绝望：绝望赌徒——加注 1.4 底池、偷牌 0.8、最广 all-in 区（14 分起 50% all-in），全桌压迫感最强。
 * 所有加注都经 legalActions 钳位（越界由 act() 拒绝，保证合法）。
 */
export function aiDecide(t, seat, level = 1) {
  const h = t.hand, la = legalActions(t, seat);
  const hole = h.hole[seat];
  const toCall = la.toCall;
  const potNow = h.committed.reduce((a, b) => a + b, 0);
  let strength, preflop = h.street === 'preflop';
  if (preflop) {
    const [a, b] = hole.slice().sort((x, y) => y.v - x.v);
    // 修复：曾赋给局部 st，strength 恒 undefined → AI 翻前面对任何加注 100% 弃牌
    strength = 0;
    if (a.v === b.v) strength = 7 + a.v; // 对子：AA≈21 KK≈20 QQ≈19
    else {
      strength = (a.v + b.v) / 2; // 大牌组合
      if (a.s === b.s) strength += 2; // 同花
      if (a.v - b.v === 1) strength += 1; // 连张
      if (a.v === 14) strength += 1;
    }
  } else {
    const ev = evaluateN([...hole, ...h.board]); // 翻牌 5 张 / 转牌 6 张 / 河牌 7 张
    strength = ev.rank * 4 + (ev.tb[0] || 0) / 4 + (h.street !== 'river' ? 3 : 0); // 成牌+后街潜力
  }
  const cheap = toCall <= t.bigBlind;
  const raiseTo = (frac) => Math.min(la.raiseMax, h.currentBet + Math.max(h.minRaise, Math.floor(potNow * frac)));

  // ── level 0 弱 AI：紧（弃得多、不偷、小注）——偶有翻后成牌小加注，可被击败 ──
  if (level === 0) {
    if (!la.canCall) {
      if (strength >= 18 && la.canRaise && t.rng() < 0.4) return { action: 'raise', amount: raiseTo(0.3) };
      return { action: 'check' };
    }
    if (strength >= 22) return { action: la.canRaise ? 'raise' : 'call', amount: raiseTo(0.3) };
    if (strength >= 16 && (toCall <= potNow / 4 || cheap)) return { action: 'call' };
    if (strength >= 10 && cheap) return { action: 'call' };
    return { action: 'fold' };
  }

  // ── level 2 强 AI：松而准（价值加注大、偷牌多）──
  if (level === 2) {
    if (!la.canCall) {
      const bluff = !preflop ? strength >= 3 : st_preflop_strong(t, hole);
      if (bluff && la.canRaise && t.rng() < 0.55) return { action: 'raise', amount: raiseTo(0.8) };
      if ((preflop && strength >= 13) || strength >= 18) {
        if (la.canRaise && t.rng() < 0.8) return { action: 'raise', amount: raiseTo(0.8) };
      }
      return { action: 'check' };
    }
    if (strength >= 22) return { action: la.canRaise ? (t.rng() < 0.6 ? 'raise' : 'allin') : 'call', amount: raiseTo(0.8) };
    if (strength >= 15 && (toCall <= potNow / 2 || cheap)) return { action: 'call' };
    if (strength >= 10 && cheap) return { action: 'call' };
    if (t.rng() < 0.3 && cheap) return { action: 'call' }; // 松：偶尔偷跟
    return { action: 'fold' };
  }

  // ── level 3 地域（v1.53）：松凶地方局——加注尺度 1.0 底池、偷牌 0.65、中牌速 all-in ──
  if (level === 3) {
    if (!la.canCall) {
      const bluff = !preflop ? strength >= 2 : st_preflop_strong(t, hole);
      if (bluff && la.canRaise && t.rng() < 0.65) return { action: 'raise', amount: raiseTo(1.0) };
      if ((preflop && strength >= 12) || strength >= 16) {
        if (la.canRaise && t.rng() < 0.85) return { action: 'raise', amount: raiseTo(1.0) };
      }
      return { action: 'check' };
    }
    if (strength >= 14) return la.canRaise ? { action: 'allin', amount: la.raiseMax } : { action: 'call' };
    if (strength >= 10 && (toCall <= potNow / 2 || cheap)) return { action: 'call' };
    if (t.rng() < 0.4 && cheap) return { action: 'call' }; // 地方局手松：爱偷廉价底
    return { action: 'fold' };
  }

  // ── level 4 绝望（v1.53）：绝望赌徒——最大尺度 1.4 底池、偷牌 0.8、最广 all-in 区，最难缠 ──
  if (level === 4) {
    if (!la.canCall) {
      const bluff = !preflop ? strength >= 1 : st_preflop_strong(t, hole);
      if (bluff && la.canRaise && t.rng() < 0.8) return { action: 'raise', amount: raiseTo(1.4) };
      if ((preflop && strength >= 10) || strength >= 12) {
        if (la.canRaise && t.rng() < 0.9) return { action: 'raise', amount: raiseTo(1.4) };
      }
      return { action: 'check' };
    }
    if (strength >= 14 || (strength >= 10 && t.rng() < 0.5)) return la.canRaise
      ? { action: 'allin', amount: la.raiseMax } : { action: 'call' };
    if (strength >= 8 && (toCall <= potNow / 2 || cheap)) return { action: 'call' };
    if (t.rng() < 0.5 && cheap) return { action: 'call' }; // 绝望局什么都想跟一口
    return { action: 'fold' };
  }

  // ── level 1 默认（= 历史 v2 行为，逐字节不变）──
  if (!la.canCall) {
    // 可过牌：大牌型加注，弱牌小概率偷盲
    const bluff = !preflop ? strength >= 3 : st_preflop_strong(t, hole);
    if ((preflop && strength >= 15) || bluff || strength >= 20) {
      if (la.canRaise && t.rng() < 0.7) return { action: 'raise', amount: raiseTo(0.5) };
    }
    return { action: 'check' };
  }
  // 必须跟/弃
  if (strength >= 24) return la.canRaise
    ? { action: t.rng() < 0.5 ? 'raise' : 'allin', amount: raiseTo(0.6) }
    : { action: 'call' };
  if (strength >= 18 && (toCall <= potNow / 2 || cheap)) return la.canRaise && t.rng() < 0.4 && toCall > t.bigBlind
    ? { action: 'raise', amount: Math.min(la.raiseMax, h.currentBet + h.minRaise) }
    : { action: 'call' };
  if (strength >= 12 && (toCall <= potNow / 3 || cheap)) return { action: 'call' };
  if (strength >= 8 && cheap) return { action: 'call' };
  return { action: 'fold' };
}
function st_preflop_strong(t, hole) {
  const [a, b] = hole.slice().sort((x, y) => y.v - x.v);
  const st = (a.v === b.v ? 7 + a.v : (a.v + b.v) / 2 + (a.s === b.s ? 2 : 0));
  return st > 14;
}

/** 整场 session：固定手数 + rebuy（在线小费局场景）。 */
export function createSession(seed, opts = {}) {
  const totalHands = opts.totalHands ?? 10;
  const rebuyLimit = opts.rebuyLimit ?? 3;
  const startStack = opts.startStack ?? 1000;
  const table = createTable(seed, { startStack });
  return {
    seed, totalHands, rebuyLimit, startStack,
    table, rebuys: [0, 0, 0, 0], handNo: 0, over: false, champ: -1,
    chips: rollChips('holdem|' + seed, 'holdem'),  // 桌面词条（v1.15 Balatro 化，seed 确定性）
    chipEarnings: [0, 0, 0, 0], lastHandChip: null // 旁路资助台账（不动 stacks，筹码守恒不变量保持）
  };
}

/** 开下一手：上一手打完才推进；开台前自动 rebuy（筹码 < 5BB 且次数未用完 → 补回起始）；打满 totalHands 手或全灭 → over。 */
export function startNextHand(sess) {
  const t = sess.table;
  if (sess.over) return t;
  if (t.hand && !handOver(t)) return t; // 上一手未结束：幂等保护，不重复开局
  applyHandChips(sess); // 上一手完手 → 记 chip 旁路资助（幂等；未开过手时 handNo=0 无结果，直接返回 null）
  // 修复：曾在发牌后立即置 over → 第 10 手发而不打、盲注 30 筹码蒸发；现在最后一手打完才收场
  if (sess.handNo >= sess.totalHands) { sess.over = true; pickChamp(sess); return t; }
  for (let s = 0; s < 4; s++) {
    if (t.stacks[s] < t.bigBlind * 5 && sess.rebuys[s] < sess.rebuyLimit) { t.stacks[s] = sess.startStack; sess.rebuys[s]++; }
  }
  const alive = t.stacks.filter(x => x > 0).length;
  if (alive < 2) { sess.over = true; pickChamp(sess); return t; }
  sess.handNo++;
  startHand(t);
  if (t.matchOver) { sess.over = true; pickChamp(sess); }
  return t;
}
function pickChamp(sess) {
  const t = sess.table;
  let c = 0;
  for (let i = 1; i < 4; i++) if (t.stacks[i] > t.stacks[c]) c = i;
  sess.champ = c;
}

/** 手是否可继续（人类下一手按钮依据）。 */
export function handPlayable(sess) { return !sess.over; }

/**
 * 桌面词条 chip 结算（v1.21，零和旁路）：
 *  - 不动 stacks（既有「筹码全程守恒」不变量保持）；资助额记入旁路台账 sess.chipEarnings。
 *  - 语义：该手赢家按手（mult 型=赢池×(mult−1)；base/bonus 型=面值），条件上下文
 *    { handRank: 摊牌时赢家 7 张最优牌型 0-9（弃牌赢=null，rank 类 chip 不触发），wonOnFlop: 翻牌圈弃牌赢 }。
 *  - 幂等：results.chipApplied 标记，重复调用不重复计。
 * @returns { handNo, bySeat: {[seat]:bonus}, total } | null（无完手结果时）
 */
export function applyHandChips(sess) {
  const t = sess.table;
  if (!t.hand || !t.hand.results) return null;
  const res = t.hand.results;
  if (res.chipApplied === sess.handNo) return sess.lastHandChip;
  res.chipApplied = sess.handNo;
  const bySeat = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let total = 0;
  // 各赢家本手赢额（fold-win=整池；showdown=按其所在池的平分份额，余数规则与 showdown 一致）
  const winBySeat = {};
  if (res.kind === 'fold-win') {
    winBySeat[res.winner] = res.pots[0].amount;
  } else {
    for (const p of res.pots) {
      const ws = p.winners.slice().sort((a, b) => ((a - t.button + 4) % 4) - ((b - t.button + 4) % 4));
      const share = Math.floor(p.amount / ws.length);
      ws.forEach((w, k) => { winBySeat[w] = (winBySeat[w] || 0) + share + (k === 0 ? p.amount - share * ws.length : 0); });
    }
  }
  for (const w of Object.keys(winBySeat).map(Number)) {
    let handRank = null;
    if (res.kind === 'showdown') handRank = evaluate7([...t.hand.hole[w], ...res.board]).rank;
    const rules = { handRank, wonOnFlop: res.kind === 'fold-win' && res.street === 'flop' };
    const { multBonus, scoreBonus } = applyChip(rules, sess.chips || []);
    const bonus = Math.round((winBySeat[w] || 0) * (multBonus - 1)) + scoreBonus;
    if (bonus > 0) { bySeat[w] += bonus; total += bonus; sess.chipEarnings[w] += bonus; }
  }
  sess.lastHandChip = { handNo: sess.handNo, bySeat, total };
  return sess.lastHandChip;
}

/**
 * v1.41 单机存档（对齐掼蛋 localStorage「继续上局」，目标① 产品持久化 + ③ 交互）：
 * serialize/restore round-trip。v1.50：rng 状态 t.rngS 为纯数据随 JSON 存档 →
 * "继续上局"后 AI 决策流与未存档局逐字节一致（ADR-5 可重放）；旧档（无 rngS）按起手重导兼容。
 * 结构校验（损坏/篡改 → 抛错，调用方降级新开）。
 * @returns {string} JSON 存档
 */
export function serialize(sess) {
  if (!sess || !sess.table || !Array.isArray(sess.table.stacks)) throw new Error('bad-session');
  return JSON.stringify(sess); // t.rng（函数）被 stringify 忽略；t.rngS（纯数据）随档保留
}
/** @param {string} json serialize 产物 → 原 sess 形态（table.rng 绑定到存档 rngS 状态，中途手续打可精确重放） */
export function restore(json) {
  const s = JSON.parse(json);
  const t = s && s.table;
  if (!s || !t || !Array.isArray(t.stacks) || t.stacks.length !== 4) throw new Error('bad-save');
  if (typeof t.seed !== 'number' || typeof t.handNo !== 'number') throw new Error('bad-save');
  if (typeof t.rngS !== 'number') t.rngS = (t.seed ^ Math.imul(t.handNo, 0x9E3779B1)) >>> 0; // v1.41 旧档兼容
  t.rng = () => stepRng(t);
  return s;
}
