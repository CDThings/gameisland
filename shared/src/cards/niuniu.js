/**
 * 牛牛（斗牛）纯逻辑 v2 —— 单机 1 人 vs 3 AI，按联网调研的通行斗牛口径：
 *  - 一副 52 张（无王）；每家 5 张。J/Q/K 记 10，A 记 1。
 *  - **排牌**：玩家自选 3 张组"牛"（3 张点数和为 10 的倍数），余 2 张个位=牛几；
 *    组不出牛=无牛。arr[seat]=所选 3 张索引（默认 bestNiu 最优组合，AI 自动用最优）。
 *  - 牌型大小（修正后单调）：无牛(0) < 牛一~牛九(1..9) < 牛牛(10) < 五花牛(11) < 炸弹(12) < 五小牛(13)；
 *    同型比最大单张（点数 K>Q>J>10…>A，同点比花色 ♠>♥>♣>♦）。
 *  - 下注：每轮可"翻倍"（底注×2）。
 *  - **结算=两两互赔（斗牛标准，非冠军通吃）**：每家与每家比，
 *    弱者付强者 底注×强者倍率；相同（牌型+最大张都相同）则互付净 0。整体严格零和。
 *  - 倍率：无牛×1、牛一~六×2、牛七/八×2、牛九×3、牛牛×4、五花/炸弹×5、五小×6。
 */
import { mulberry32 } from '../rng.js';
import { rollChips, applyChip } from './meta.js';

export const SUITS = ['S', 'H', 'C', 'D']; // 花色大小序：黑桃>红桃>梅花>方块
export const NIU_MULT = { wuxiao: 6, zhadan: 5, wuhua: 5, niuniu: 4, niu9: 3, niuLow: 2, none: 1 };
export const TYPE_CN = { wuxiao: '五小牛', zhadan: '炸弹', wuhua: '五花牛', niuniu: '牛牛', niu: '牛', none: '无牛' };

export function buildDeck() {
  const d = [];
  let id = 0;
  for (const s of SUITS) for (let v = 1; v <= 13; v++) d.push({ s, v, id: id++ });
  return d; // 52
}

const pts = v => (v >= 11 ? 10 : v); // J/Q/K=10，A=1
const suitRank = c => SUITS.indexOf(c.s);
/** 单张比较键：先点数后花色。 */
export function cardKey(c) { return c.v * 10 + (3 - suitRank(c)); }
export function maxCard(cards) { return Math.max(...cards.map(cardKey)); }

/**
 * 同型比较键：炸弹=四张的点数（修复：曾比 5 张最大单张，kicker 抢权，2222+K 误胜 3333+4）；
 * 其它牌型=最大单张（点数×10+花色权重）。
 */
export function cmpKeyOf(n) {
  if (n.type === 'zhadan') {
    const cc = {};
    n.cards.forEach(c => { cc[c.v] = (cc[c.v] || 0) + 1; });
    const quadV = +Object.keys(cc).find(v => cc[v] === 4);
    return quadV * 10;
  }
  return maxCard(n.cards);
}

/**
 * 按指定 3 张（chosen=索引组）判牛型。整手特殊型（五小/炸弹/五花）优先，与排法无关。
 * → {type, niu, use:[3索引]}（无牛时 use=所选 3 张，niu=0）。
 */
export function niuFor(cards, chosen) {
  const vals = cards.map(c => pts(c.v));
  const sum = vals.reduce((a, b) => a + b, 0);
  if (cards.every(c => c.v < 5) && sum <= 10) return { type: 'wuxiao', niu: 0, use: [0, 1, 2] };
  const cnt = {};
  cards.forEach(c => { cnt[c.v] = (cnt[c.v] || 0) + 1; });
  if (Object.values(cnt).some(n => n === 4)) return { type: 'zhadan', niu: 0, use: [0, 1, 2] };
  if (cards.every(c => c.v >= 11)) return { type: 'wuhua', niu: 0, use: [0, 1, 2] };
  const idx = chosen && chosen.length === 3 ? chosen : [0, 1, 2];
  const s3 = vals[idx[0]] + vals[idx[1]] + vals[idx[2]];
  if (s3 % 10 !== 0) return { type: 'none', niu: 0, use: idx }; // 所选 3 张不成牛 → 无牛
  const rest = [0, 1, 2, 3, 4].filter(i => idx[0] !== i && idx[1] !== i && idx[2] !== i);
  const s2 = (vals[rest[0]] + vals[rest[1]]) % 10;
  if (s2 === 0) return { type: 'niuniu', niu: 10, use: idx };
  return { type: 'niu', niu: s2, use: idx };
}

/** 5 张牌的最佳牛型（枚举 C(5,3) 全组合取最大）。 */
export function bestNiu(cards) {
  let best = null;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let d = b + 1; d < 5; d++) {
    const n = niuFor(cards, [a, b, d]);
    if (!best) { best = n; continue; }
    const nr = rankOf(n), br = rankOf(best);
    if (nr.r > br.r || (nr.r === br.r && n.niu > best.niu)) best = n;
  }
  return best;
}

/**
 * 牛牛 AI 策略层（v1.23，对齐掼蛋 ai.js 的"纯逻辑确定性策略"模式）：
 *  - 难度三档：0 弱（常排非最优甚至无牛，可被击败）/ 1 中（多半最优、偶降一档）/ 2 强（恒最优）。
 *  - 全程 seeded rng（调用方传 mulberry32(seed^seat^round)）→ 同 seed 同难度同座位可重放。
 *  - 不碰结算规则：只决定"排哪 3 张 + 是否想翻倍"，互赔零和不变量由 settle 保持。
 */
/** 全组合枚举（C(5,3)=10 种）按牌型值降序 */
export function allPlans(hand) {
  const plans = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let d = b + 1; d < 5; d++) {
    const n = niuFor(hand, [a, b, d]);
    plans.push({ use: n.use, niu: n, key: rankOf(n).r * 100 + (n.type === "niu" ? n.niu : 0) });
  }
  plans.sort((x, y) => y.key - x.key || (rankOf(y.niu).r - rankOf(x.niu).r));
  return plans;
}
/** 大牌型（翻倍价值高）：牛牛/五花/炸弹/五小（rank≥10） */
export function wantsDouble(n) { return rankOf(n).r >= 10; }

/**
 * 翻倍意向提示（v1.24 信息显示，对齐掼蛋"报牌"）：按牛型强度给出是否建议翻倍的文案
 * （纯函数，供 HUD 展示 / AI 决策，不影响结算）。
 * strong(r≥10,=wantsDouble) 建议翻倍；mid(5≤r<10) 视对手；weak(r<5) 不宜翻倍。
 * @param {object} niu 一个牛型结果（niuOf / bestNiu 的返回）
 */
export function niuDblHint(niu) {
  const { r, cn } = rankOf(niu);
  const strong = wantsDouble(niu);
  return {
    rank: r, cn, strong,
    suggest: strong ? 'double' : (r >= 5 ? 'hold' : 'skip'),
    text: strong ? '牌面较强 · 可翻倍' : (r >= 5 ? '牌面中等 · 视对手' : '牌面偏弱 · 不宜翻倍'),
  };
}
/** 手牌入口：按 5 张手牌的最优牛型给翻倍意向（程序/AI 用；UI 玩家侧应基于其当前排法 myNiu 调 niuDblHint）。 */
export function doubleHint(hand) { return niuDblHint(bestNiu(hand)); }

/**
 * AI 排法决策：返回 { chosen(3索引), niu, wantsDouble }。
 * @param {object} hand 5 张手牌
 * @param {0|1|2|3|4} level 难度（缺省 2=最优，保持向后兼容；3/4 排法同 2 恒最优，
 *   地域/绝望档的额外行为是"庄家宣布翻倍"，见 dealerDoubleIntent，不在排法层实现）
 * @param {() => number} rng seeded 随机源（缺省 Math.random，单测/回放必须传 mulberry32）
 */
export function aiNiuPlan(hand, level = 2, rng = Math.random) {
  const plans = allPlans(hand);
  const mk = (p) => ({ chosen: p.use, niu: p.niu, wantsDouble: wantsDouble(p.niu) });
  if (level >= 2) return mk(plans[0]); // 强：恒最优
  if (level <= 0) {
    const r = rng();
    if (r < 0.4) return mk(plans[plans.length - 1]);                 // 弱：经常摆烂（最低档/无牛）
    if (r < 0.75) return mk(plans[Math.floor(rng() * plans.length)]); // 随机档
    return mk(plans[0]);                                             // 偶尔清醒
  }
  // level 1 中：多半最优，偶降一档
  return mk(rng() < 0.7 ? plans[0] : (plans[1] || plans[0]));
}

/** 牌型等级（越大越强）与名称：无牛0 < 牛1-9 < 牛牛10 < 五花11 < 炸弹12 < 五小13。 */
export function rankOf(n) {
  if (n.type === 'wuxiao') return { r: 13, cn: TYPE_CN.wuxiao };
  if (n.type === 'zhadan') return { r: 12, cn: TYPE_CN.zhadan };
  if (n.type === 'wuhua') return { r: 11, cn: TYPE_CN.wuhua };
  if (n.type === 'niuniu') return { r: 10, cn: TYPE_CN.niuniu };
  if (n.type === 'niu') return { r: n.niu, cn: `牛${['一', '二', '三', '四', '五', '六', '七', '八', '九'][n.niu - 1]}` };
  return { r: 0, cn: TYPE_CN.none };
}

/** a 是否胜 b（牌型 > 同型比比较键：炸弹比四张点数、其余比最大单张）。 */
export function beatsN(a, b) {
  const ra = rankOf(a).r, rb = rankOf(b).r;
  if (ra !== rb) return ra > rb;
  return cmpKeyOf(a) > cmpKeyOf(b);
}

/** 倍率（互赔付款依据）。 */
export function multOf(n) {
  const r = rankOf(n).r;
  if (n.type === 'wuxiao') return NIU_MULT.wuxiao;
  if (n.type === 'zhadan') return NIU_MULT.zhadan;
  if (n.type === 'wuhua') return NIU_MULT.wuhua;
  if (n.type === 'niuniu') return NIU_MULT.niuniu;
  if (r === 9) return NIU_MULT.niu9;
  if (r >= 1 && r <= 8) return NIU_MULT.niuLow; // 牛一~牛八
  return NIU_MULT.none;
}

/** 开一轮：发 5 张 ×4；arr 初始=各家最优排法（AI 直接最优；人类可在亮牌前自选）。 */
/**
 * v1.25 当前轮提示（对齐掼蛋 turn-hint；牛牛为同时亮牌制，无逐座回合——
 * 人类座位(0)在结算前是唯一可交互者，故 activeSeat 恒 0）。
 * kind ∈ your-turn(待你组牛/亮牌) | done(已结算) | idle(无对局)。
 * @param {object} round 单个对局（createRound 返回）
 */
export function turnHint(round) {
  if (!round) return { activeSeat: -1, kind: 'idle' };
  if (round.settled) return { activeSeat: -1, kind: 'done' };
  return { activeSeat: 0, kind: 'your-turn' };
}

export function createRound(seed, baseBet = 10) {
  const rng = mulberry32(seed >>> 0);
  const deck = buildDeck();
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const hands = [deck.slice(0, 5), deck.slice(5, 10), deck.slice(10, 15), deck.slice(15, 20)];
  const arr = hands.map(h => bestNiu(h).use);
  return { seed, baseBet, hands, arr, settled: null };
}

/** 指定座位的牛型（按 arr 排法；未排则取最优）。 */
export function niuOf(round, seat) {
  const n = niuFor(round.hands[seat], round.arr[seat]);
  n.cards = round.hands[seat];
  return n;
}

/** 人类改排法：cardIds=手牌里 3 张的 id（可任意 3 张；不成牛=无牛，允许"摆烂"排法但不鼓励）。 */
export function arrange(round, seat, cardIds) {
  if (round.settled) return { ok: false, reason: 'settled' };
  const hand = round.hands[seat];
  if (!Array.isArray(cardIds) || cardIds.length !== 3 || new Set(cardIds).size !== 3) return { ok: false, reason: 'bad-pick' };
  const idx = cardIds.map(id => hand.findIndex(c => c.id === id));
  if (idx.some(x => x < 0)) return { ok: false, reason: 'not-in-hand' };
  round.arr[seat] = idx;
  return { ok: true, niu: niuOf(round, seat) };
}

/** 一键盘最优排法（撤销自选）。 */
export function autoArrange(round, seat) {
  if (round.settled) return { ok: false, reason: 'settled' };
  round.arr[seat] = bestNiu(round.hands[seat]).use;
  return { ok: true, niu: niuOf(round, seat) };
}

/**
 * 亮牌结算（两两互赔，零和）：
 * 每对 (i,j)：牌型强者收 底注×强者倍率；牌型与最大张全同 → 互付净 0。
 * 返回 {deltas:[4], transfers:[{from,to,amount,draw}], bigSeats, lines}。
 */
export function settle(round) {
  if (round.settled) return round.settled;
  const nius = [0, 1, 2, 3].map(s => niuOf(round, s));
  const deltas = [0, 0, 0, 0];
  const transfers = [];
  const lines = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const ra = rankOf(nius[i]), rb = rankOf(nius[j]);
    let winner = -1;
    if (ra.r !== rb.r) winner = ra.r > rb.r ? i : j;
    else {
      const ka = cmpKeyOf(nius[i]), kb = cmpKeyOf(nius[j]);
      if (ka !== kb) winner = ka > kb ? i : j;
    }
    if (winner === -1) { transfers.push({ from: i, to: j, amount: 0, draw: true }); continue; }
    const loser = winner === i ? j : i;
    const amt = round.baseBet * multOf(nius[winner]);
    deltas[winner] += amt;
    deltas[loser] -= amt;
    transfers.push({ from: loser, to: winner, amount: amt, draw: false });
    const lw = winner === i ? rb : ra, ww = winner === i ? ra : rb; // 修复：文案牌型曾错位（赢家牌型打在输家名下）
    lines.push(`${loser === 0 ? '你' : 'AI' + loser}(${lw.cn}) → ${winner === 0 ? '你' : 'AI' + winner}(${ww.cn}) 付 ${amt}`);
  }
  const bigR = Math.max(...nius.map(n => rankOf(n).r));
  const res = {
    deltas, transfers,
    bigSeats: nius.map((n, s) => (rankOf(n).r === bigR ? s : -1)).filter(s => s >= 0),
    bigCn: rankOf(nius.find(n => rankOf(n).r === bigR)).cn,
    lines,
  };
  round.settled = res;
  return res;
}

// ── 桌面词条 chip（v1.15 Balatro 化）：结算后应用，倍率零和安全（同乘双方），bonus 为资助型 ──
/**
 * 把 session 级 chips 应用到一轮结算结果：
 *  - mult 型 chip：对该对"赢家牌型触发"时，amt 同乘双方（保持严格零和）。
 *  - base/bonus 型 chip：仅加到赢家净分（底注外资助，offline 不计积分，破坏零和 chipBonus 部分会被显式记录）。
 * 条件上下文 rules = { niuType: 赢家牌型, doubled: 本轮是否翻倍 }。
 * @returns 原 res（就地改 deltas/transfers，新增 chipBonus/zeroSumNet）
 */
export function applySessionChips(round, res, chips) {
  if (!res) return res;
  if (res.chipApplied) return res; // 幂等守卫（res 缓存在 round.settled，防止重复应用）
  res.chipApplied = true;
  if (!chips || !chips.length) {
    res.chipBonus = 0;
    res.zeroSumNet = res.deltas.reduce((a, b) => a + b, 0);
    return res;
  }
  const nius = [0, 1, 2, 3].map((s) => niuOf(round, s));
  const doubled = round.doubled ?? round.baseBet > 10; // v1.50：翻倍事实源（旧档无字段时回退 baseBet 口径）
  const deltas = [0, 0, 0, 0];
  let chipBonus = 0;
  for (const t of res.transfers) {
    if (t.draw) continue;
    const winner = t.to;
    const { multBonus, scoreBonus } = applyChip({ niuType: nius[winner].type, doubled }, chips);
    // 纯后处理：deltas 用"原 t.amount × mult"，不改写缓存的 t.amount（UI 基础流水保持原值）
    const amt = Math.round(t.amount * multBonus);
    deltas[winner] += amt;
    deltas[t.from] -= amt;
    t.chipMult = multBonus;
    if (scoreBonus > 0) {
      deltas[winner] += scoreBonus;
      chipBonus += scoreBonus;
      t.chipBonus = scoreBonus;
    }
  }
  res.deltas = deltas;
  res.chipBonus = chipBonus;
  // 零和判定：倍率部分零和；资助 bonus 让净和 = chipBonus（显式可观测）
  res.zeroSumNet = deltas.reduce((a, b) => a + b, 0);
  return res;
}

// ── 整场（8 轮，累计净分排名；每轮可翻倍）──
export function createSession(seed, baseBet = 10, hands = 8) {
  const rng = mulberry32(seed >>> 0);
  return { seed, baseBet, hands, roundNo: 0, scores: [0, 0, 0, 0], rounds: [], over: false, champ: -1, round: null, dealer: Math.floor(rng() * 4), chips: rollChips('niuniu|' + seed, 'niuniu') };
}

export function startRound(sess) {
  if (sess.over) return null;
  sess.roundNo++;
  sess.round = createRound((sess.seed ^ Math.imul(sess.roundNo, 0x9E3779B1)) >>> 0, sess.baseBet);
  sess.round.doubled = false; // v1.50：翻倍事实源（setDouble 改写；UI/chip/日志统一读这里）
  return sess.round;
}

/** x2=true 时本轮底注翻倍（互赔金额同步翻倍，轮内可随时决定、结算前生效）。v1.50：round.doubled 为"是否翻倍"唯一事实源。 */
export function setDouble(sess, x2) {
  if (sess.round && !sess.round.settled) {
    sess.round.baseBet = (x2 ? 2 : 1) * sess.baseBet;
    sess.round.doubled = !!x2;
  }
  return sess.round;
}

/** 结算一轮并累计（保持 round 供结果面板；下一轮 startRound 覆盖）。
 *  庄家机制（v1.50 通行斗牛"连庄"口径）：庄家自家有牛（rank≥1）→ 连庄；无牛 → 过庄顺时针。 */
export function settleRound(sess) {
  if (!sess.round || sess.round.settled) return null;
  const res = applySessionChips(sess.round, settle(sess.round), sess.chips || []);
  for (let i = 0; i < 4; i++) sess.scores[i] += res.deltas[i];
  const dealerNiu = rankOf(niuOf(sess.round, sess.dealer)).r;
  if (dealerNiu >= 1) { /* 庄家有牛 → 连庄 */ }
  else sess.dealer = (sess.dealer + 1) % 4; // 庄家无牛 → 过庄
  sess.rounds.push({ roundNo: sess.roundNo, deltas: res.deltas, baseBet: sess.round.baseBet, doubled: !!sess.round.doubled, dealer: sess.dealer });
  if (sess.roundNo >= sess.hands) {
    sess.over = true;
    let c = 0;
    for (let i = 1; i < 4; i++) if (sess.scores[i] > sess.scores[c]) c = i;
    sess.champ = c;
  }
  return res;
}

/**
 * v1.33 整场记分牌（掼蛋"打级方/级牌进度"的牛牛等价）：把累计分聚合成展示结构——
 * 领先者 / 分差 / 进度（轮次/总轮）。纯函数，关系可单测（leader=argmax、spread=max-min）。
 * @returns {{ leader, scores, spread, roundNo, hands, progress, over, champ }}
 */
export function scoreboard(sess) {
  if (!sess || !Array.isArray(sess.scores)) return null;
  const scores = sess.scores;
  let leader = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[leader]) leader = i;
  const max = Math.max(...scores), min = Math.min(...scores);
  return {
    leader,
    scores: scores.slice(),
    spread: max - min,
    roundNo: sess.roundNo,
    hands: sess.hands,
    progress: Math.min(1, (sess.roundNo || 0) / (sess.hands || 1)),
    over: !!sess.over,
    champ: sess.champ,
  };
}

/**
 * v1.34 整场结算日志（对齐掼蛋 playlog / 德州下注日志 / 麻将弃牌河）：牛牛此前无行动日志。
 * 把 sess.rounds 聚合成可读条目：每轮 庄家 / 是否翻倍 / 各家净分 / 净胜者。纯函数，关系可单测。
 * @returns Array<{ roundNo, dealer, doubled, net:number[], winners:number[] }>
 */
export function roundLog(sess) {
  if (!sess || !Array.isArray(sess.rounds)) return [];
  return sess.rounds.map((r) => {
    const winners = [];
    for (let i = 0; i < r.deltas.length; i++) if (r.deltas[i] > 0) winners.push(i);
    return { roundNo: r.roundNo, dealer: r.dealer, doubled: r.doubled ?? r.baseBet > 10, net: r.deltas.slice(), winners };
  });
}

/**
 * v1.53 庄家宣布翻倍（地域/绝望档）：庄家（AI 座）按自己手牌强度宣布本轮翻倍——
 * 地域（3）：大牌型（牛牛 r≥10）恒宣布、中牌型（5≤r<10）45% 宣布；
 * 绝望（4）：大牌型恒宣布、中牌型 80% 宣布、弱牌型（r<5）仍 20% 搏一把。
 * 纯函数：只读 sess.round/sess.dealer + 外部传入的 rng，同 seed 可重放。
 * level<3 恒 false（低档零回归：翻倍仍由玩家 ×2 按钮控制）。
 * @returns {boolean} 是否宣布翻倍（true → 调用方 setDouble(sess, true)）
 */
export function dealerDoubleIntent(sess, level, rng = Math.random) {
  if (level < 3 || !sess.round || !sess.round.hands) return false;
  const r = rankOf(niuOf(sess.round, sess.dealer)).r;
  if (r >= 10) return true;
  if (r >= 5) return rng() < (level >= 4 ? 0.8 : 0.45);
  return level >= 4 && rng() < 0.2;
}

/**
 * v1.29 自动打完整场（掼蛋 S.auto 的共享可测核心；牛牛为同时亮牌制，无逐座回合——
 * 自动=每轮按难度 level 给 4 家（含人类）排法 + 结算 + 下一轮，直到 sess.over）。
 * v1.50 确定性口径统一：AI 排法默认按 房间 applyAiPlans 同款派生（seed^轮号^座位），
 * "自动打完整场"与牌桌内自动（applyAiPlans 逐轮驱动）结果一致；可传自定义 rng 覆盖。返回终局 sess。
 * v1.53：地域/绝望档（level≥3）每轮追加"庄家宣布翻倍"（独立 rng 通道 4，不扰动 0-3 座的排法流）。
 */
export function autoPlayMatch(sess, level = 1, rngFor) {
  const mkRng = rngFor || ((seat) => mulberry32(((sess.seed ^ Math.imul(sess.roundNo, 0x9E3779B1)) ^ seat) >>> 0));
  let guard = 0;
  while (!sess.over && guard++ < 200) {
    if (!sess.round || sess.round.settled) startRound(sess);
    const r = sess.round;
    for (let s = 0; s < 4; s++) r.arr[s] = aiNiuPlan(r.hands[s], level, mkRng(s)).chosen;
    if (level >= 3 && !r.doubled && dealerDoubleIntent(sess, level, mkRng(4))) setDouble(sess, true);
    if (!r.settled) settleRound(sess);
  }
  return sess;
}

/**
 * v1.41 单机存档（对齐掼蛋 localStorage「继续上局」，目标① 产品持久化 + ③ 交互）：
 * serialize/restore round-trip。niuniu session 及其 round=createRound 结果**全 plain**（无闭包 rng），
 * JSON 直接可存；restore 仅做结构校验（损坏/被篡改 → 抛错，调用方降级为新开一局，避免半残态卡死界面）。
 * @returns {string} JSON 存档
 */
export function serialize(sess) {
  if (!sess || !Array.isArray(sess.scores)) throw new Error('bad-session');
  return JSON.stringify(sess);
}
/** @param {string} json serialize 产物 → 原 session 形态（可直接接 startRound/settleRound/applyAiPlans） */
export function restore(json) {
  const s = JSON.parse(json);
  if (!s || typeof s !== 'object') throw new Error('bad-save');
  if (!Array.isArray(s.scores) || s.scores.length !== 4) throw new Error('bad-save');
  if (!Array.isArray(s.rounds) || typeof s.roundNo !== 'number' || typeof s.seed !== 'number') throw new Error('bad-save');
  return s;
}
