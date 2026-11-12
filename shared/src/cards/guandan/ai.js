/**
 * 掼蛋 AI（3 家机器对手）+ 提示。
 * 目标：合法、可整场打完、有策略（同伴配合、省炸弹、压制快出的对手、逢人配活用）。
 * 纯逻辑，node --test 可测（整场 4-AI 模拟即靠它）。
 *
 * 难度五级（v1.49）：0 普通 / 1 进阶 / 2 高阶（默认，=v1.49 前行为零回归）/ 3 地域 / 4 绝望。
 * 全程确定性——决策只依赖对局状态 + 座位 + 档位，同 seed 可重放。
 */

import { recognize, beats, TYPE, SEQ_WINDOWS } from './combos.js';
import { isWild, isJoker, strength } from './cards.js';
import { partnerOf, teamOf, activeSeats } from './engine.js';

/** 手牌分组：byVal(自然牌)、wilds(逢人配)、jokers(大小王)。全部为真实手牌对象。 */
function group(hand, wildValue) {
  const byVal = new Map();
  const wilds = [];
  const jokers = [];
  for (const c of hand) {
    if (isJoker(c)) { jokers.push(c); continue; }
    if (isWild(c, wildValue)) { wilds.push(c); continue; }
    const a = byVal.get(c.v) || []; a.push(c); byVal.set(c.v, a);
  }
  return { byVal, wilds, jokers, wildValue };
}

/** 凑 k 张同点 v（优先自然牌，wild 补位）；不够返回 null。 */
function makeSame(g, v, k) {
  const nat = g.byVal.get(v) || [];
  if (nat.length >= k) return nat.slice(0, k);
  const need = k - nat.length;
  if (need > g.wilds.length) return null;
  return [...nat, ...g.wilds.slice(0, need)];
}

function allVals(g) {
  const vals = [...g.byVal.keys()];
  if (g.wilds.length && !g.byVal.has(g.wildValue)) vals.push(g.wildValue);
  return vals;
}
function jokersOf(g, v, n) { return g.jokers.filter(j => j.v === v).slice(0, n); }
function disjointIds(a, b) {
  const s = new Set(a.map(c => c.id));
  return b.every(c => !s.has(c.id));
}

/** 按窗口 w 每点 perValue 张拼连张（wild 补位；preferFlush 时优先取同花色）。 */
function buildWindow(g, w, perValue, preferFlush) {
  const vals = [...w.vals];
  if (preferFlush) {
    for (const su of ['S', 'H', 'D', 'C']) {
      const per = vals.map(v => (g.byVal.get(v) || []).find(c => c.s === su));
      if (per.every(Boolean)) return per; // 纯同花
    }
  }
  const out = [];
  let wildUsed = 0;
  for (const v of vals) {
    let cards = (g.byVal.get(v) || []).slice(0, perValue);
    if (cards.length < perValue) {
      const need = perValue - cards.length;
      if (wildUsed + need > g.wilds.length) return null;
      cards = [...cards, ...g.wilds.slice(wildUsed, wildUsed + need)];
      wildUsed += need;
    }
    out.push(...cards);
  }
  return out;
}

/** 枚举能压过 prev 的候选，按 (power, main) 升序（最省优先）。 */
export function beatingPlays(hand, prev, wildValue) {
  const g = group(hand, wildValue);
  const cands = [];
  const add = (cards) => {
    if (!cards || !cards.length) return;
    const uniq = new Set(cards.map(c => c.id));
    if (uniq.size !== cards.length) return; // 用了两张同牌
    const c = recognize(cards, wildValue);
    if (c && beats(c, prev)) cands.push({ cards, combo: c });
  };

  if (prev.power === 0) {
    // 基础型（单/对/三/三带二）：官方规则同型互压——只能用同型更大的牌压
    switch (prev.type) {
      case TYPE.SINGLE:
        for (const v of allVals(g)) add(makeSame(g, v, 1));
        add(jokersOf(g, 'S', 1)); add(jokersOf(g, 'B', 1));
        break;
      case TYPE.PAIR:
        for (const v of allVals(g)) add(makeSame(g, v, 2));
        if (g.jokers.filter(j => j.v === 'S').length >= 2) add(jokersOf(g, 'S', 2));
        if (g.jokers.filter(j => j.v === 'B').length >= 2) add(jokersOf(g, 'B', 2));
        break;
      case TYPE.TRIPLE:
        for (const v of allVals(g)) add(makeSame(g, v, 3));
        break;
      case TYPE.TRIPLE_PAIR:
        for (const tv of allVals(g)) for (const pv of allVals(g)) {
          if (tv === pv) continue;
          const t = makeSame(g, tv, 3), p = makeSame(g, pv, 2);
          if (t && p && disjointIds(t, p)) add([...t, ...p]);
        }
        break;
    }
  } else if (prev.power === 1) {
    // 连张类：仅同型更大的可压
    if (prev.type === TYPE.STRAIGHT) for (const w of SEQ_WINDOWS[5]) add(buildWindow(g, w, 1, false));
    else if (prev.type === TYPE.RUNPAIRS) for (const w of SEQ_WINDOWS[3]) add(buildWindow(g, w, 2));
    else if (prev.type === TYPE.STEELPLATE) for (const w of SEQ_WINDOWS[2]) add(buildWindow(g, w, 3));
  }
  // 炸弹类通配（任何牌型都可被更大阶梯的炸弹/同花顺/天王炸压）
  for (const v of allVals(g)) for (let s = 4; s <= 8; s++) add(makeSame(g, v, s));
  for (const w of SEQ_WINDOWS[5]) add(buildWindow(g, w, 1, true));
  if (g.jokers.filter(j => j.v === 'B').length >= 2 && g.jokers.filter(j => j.v === 'S').length >= 2)
    add([...jokersOf(g, 'B', 2), ...jokersOf(g, 'S', 2)]);

  cands.sort((a, b) => (a.combo.power - b.combo.power) || (a.combo.main - b.combo.main));
  return cands;
}

/** 领出时的候选：烧牌多的连张/对子（避免先扔炸弹）。 */
function leadCandidates(g, wildValue) {
  const opts = [];
  for (const w of SEQ_WINDOWS[2]) { const b = buildWindow(g, w, 3); if (b) opts.push(b); }
  for (const w of SEQ_WINDOWS[3]) { const b = buildWindow(g, w, 2); if (b) opts.push(b); }
  for (const w of SEQ_WINDOWS[5]) { const b = buildWindow(g, w, 1); if (b) opts.push(b); }
  for (const v of g.byVal.keys()) if ((g.byVal.get(v) || []).length >= 2) opts.push(makeSame(g, v, 2));
  const legal = opts.filter(c => c && c.length && recognize(c, wildValue));
  return legal;
}

/** 手中最小的 4 炸（power=1，主点最小），用于领出压制 / 抢牌权。 */
function findSmallestBomb(g, wv) {
  let best = null, bestMain = Infinity;
  for (const v of allVals(g)) {
    const b = makeSame(g, v, 4);
    if (!b) continue;
    const main = v === wv ? 13 : v - 2;
    if (main < bestMain) { best = b; bestMain = main; }
  }
  return best;
}
/** 手中力量最大的单张（王 > 逢人配(级牌) > 自然大点）。 */
function maxSingle(g) {
  if (g.jokers.length) return g.jokers.find(j => j.v === 'B') || g.jokers[0];
  if (g.wilds.length) return g.wilds[0];
  const vals = [...g.byVal.keys()].sort((a, b) => a - b);
  if (!vals.length) return null;
  const top = vals[vals.length - 1];
  return g.byVal.get(top)[0];
}
/** 对家是否至少有一对（用于领出配合）。 */
function partnerHasPair(partnerHand) {
  const cnt = new Map();
  for (const c of partnerHand) {
    const k = c.s === 'J' ? 'J' + c.v : String(c.v);
    cnt.set(k, (cnt.get(k) || 0) + 1);
    if (cnt.get(k) >= 2) return true;
  }
  return false;
}
/** 手中最小对子。 */
function smallestPair(g) {
  const vals = [...g.byVal.keys()].sort((a, b) => a - b);
  for (const v of vals) if (g.byVal.get(v).length >= 2) return makeSame(g, v, 2);
  if (g.wilds.length >= 2) return g.wilds.slice(0, 2);
  for (const v of vals) if (g.byVal.get(v).length === 1 && g.wilds.length >= 1) return [g.byVal.get(v)[0], g.wilds[0]];
  return null;
}

/** 手中力量最小的单张（自然小点 > 逢人配 > 小王 > 大王）。 */
function minSingle(g) {
  const vals = [...g.byVal.keys()].sort((a, b) => a - b);
  if (vals.length) return g.byVal.get(vals[0])[0];
  if (g.wilds.length) return g.wilds[0];
  const s = jokersOf(g, 'S', 1)[0] || jokersOf(g, 'B', 1)[0];
  return s;
}

/**
 * 领出（自由出牌）—— 按局势而非无脑出单张：
 *  1) 对手快出完(≤3 张) → 压制：有 4 炸出炸抢权，否则出最大单张拦；
 *  2) 对家快出完(≤3 张) → 配合：对家有对子出最小对子，否则出最小单张助攻；
 *  3) 常态 → 烧牌的连张/对子优先（钢板>三连对>顺子>对子），避免先出单张；
 *  4) 兜底 → 最小单张。
 */
function leadPlay(m, seat, g, wv) {
  const partner = partnerOf(seat);
  const partnerHand = m.hands[partner];
  const oppSeats = activeSeats(m).filter(s => teamOf(s) === (teamOf(seat) ^ 1));
  const oppMin = oppSeats.length ? Math.min(...oppSeats.map(s => m.hands[s].length)) : 99;

  // 1) 压制对手
  if (oppMin <= 3) {
    const b4 = findSmallestBomb(g, wv);
    if (b4) return { cards: b4 };
    const mx = maxSingle(g);
    return mx ? { cards: [mx] } : { pass: true };
  }
  // 2) 配合对家
  if (partnerHand.length <= 3) {
    if (partnerHasPair(partnerHand)) {
      const p = smallestPair(g);
      if (p) return { cards: p };
    }
    const s = minSingle(g);
    return s ? { cards: [s] } : { pass: true };
  }
  // 3) 常态：烧牌连张/对子（绝不先出单张，除非没有别的）
  const opts = leadCandidates(g, wv);
  if (opts.length) {
    opts.sort((a, b) => b.length - a.length || (recognize(a, wv).main - recognize(b, wv).main));
    return { cards: opts[0] };
  }
  // 4) 兜底
  const single = minSingle(g);
  return single ? { cards: [single] } : { pass: true };
}

/** 手中"真炸弹"数量：≥4 张同点的点数种类数 +（若有 2 大王 2 小王则 +1 天王炸）。 */
function bombCount(g) {
  let n = 0;
  for (const v of g.byVal.keys()) if (g.byVal.get(v).length >= 4) n++;
  if (g.jokers.filter(j => j.v === 'B').length >= 2 && g.jokers.filter(j => j.v === 'S').length >= 2) n++;
  return n;
}

/**
 * 难度五级（v1.49）。全程确定性：决策只依赖对局状态（m）+ 座位 + 档位，同 seed 可重放。
 *   0 普通 / 1 进阶 / 2 高阶（默认＝v1.49 前行为，零回归基线）/ 3 地域 / 4 绝望。
 * 返回 {cards} 或 {pass:true}。
 */
export const LEVELS = [
  { id: 0, cn: '普通', desc: '休闲出牌，几乎不用炸，可被击败' },
  { id: 1, cn: '进阶', desc: '烧牌领出、廉价跟牌，只在对手收尾时用炸' },
  { id: 2, cn: '高阶', desc: '读局势：压制对手、配合搭档、抢炸定夺（默认档）' },
  { id: 3, cn: '地域', desc: '地域老手：按搭档手牌喂牌、藏炸控节奏' },
  { id: 4, cn: '绝望', desc: '极限压榨：领出本圈烧牌最大化、不攥 A/级牌、提前上最强炸' },
];
export const levelCn = (l) => ((LEVELS.find(x => x.id === l) || LEVELS[2]).cn);

export function choose(m, seat, level = 2) {
  const g = group(m.hands[seat], m.handLevel);
  switch (level) {
    case 0: return chooseL0(m, seat, g, m.handLevel);
    case 1: return chooseL1(m, seat, g, m.handLevel);
    case 3: return chooseL3(m, seat, g, m.handLevel);
    case 4: return chooseL4(m, seat, g, m.handLevel);
    default: return chooseL2(m, seat, g, m.handLevel);
  }
}

/* ── 档位 2（高阶）＝ v1.49 前的完整行为，逐字节保留作零回归基线 ── */

/** 跟牌预计算（各档共享）：廉价候选/炸弹候选/对手收尾距离等。 */
function followPre(m, seat, g, wv) {
  const hand = m.hands[seat];
  const partner = partnerOf(seat);
  const prev = m.leaderCombo;
  const cands = beatingPlays(hand, prev, wv)
    .filter(x => x.cards.every(c => hand.some(h => h.id === c.id)));
  const oppSeats = activeSeats(m).filter(s => teamOf(s) === (teamOf(seat) ^ 1));
  const oppMin = oppSeats.length ? Math.min(...oppSeats.map(s => m.hands[s].length)) : 99;
  const cheap = cands.filter(c => c.combo.power < 2);        // 非炸（基础+连张），升序
  const bombs = cands.filter(c => c.combo.power >= 2);       // 炸弹类（4炸..天王炸）
  const b4 = bombs.find(b => b.combo.power === 2);           // 最小 4 炸
  const myBombs = bombCount(g);
  const cheapBest = cheap[0];
  // 连张类(顺/三连对/钢板)直接算可接受；基础型需 main≤10 才算廉价
  const cheapAffordable = !!cheapBest && (cheapBest.combo.power === 1 || cheapBest.combo.main <= 10);
  return { cands, leader: m.trickOwner, partner, oppMin, cheap, bombs, b4, myBombs, hand, cheapBest, cheapAffordable };
}

/** 高档（2）跟牌：策略＝v1.49 前行为（对手≤2 张上最强炸 / 4 炸抢权 / 保留 A 级牌 / 兜底最小炸）。 */
function followL2(p) {
  if (!p.cands.length) return { pass: true };
  if (p.leader === p.partner) {
    // 不压同伴；仅当对手快出完时用 4 炸拦
    if (p.oppMin <= 3 && p.b4) return { cards: p.b4.cards };
    return { pass: true };
  }
  if (p.oppMin <= 2 && p.bombs.length) return { cards: p.bombs[p.bombs.length - 1].cards }; // 最强炸拦
  // 关键改进：有 4 炸且值得时用 4 炸抢牌权，而不是只会过牌/浪费大牌
  if (p.b4 && (!p.cheapAffordable || p.oppMin <= 5 || p.myBombs >= 2 || p.hand.length <= 9)) {
    return { cards: p.b4.cards };
  }
  if (p.cheapBest) {
    if (p.cheapBest.combo.power === 0 && p.cheapBest.combo.main >= 12 && p.oppMin > 5) return { pass: true }; // 保留 A/级牌
    return { cards: p.cheapBest.cards };
  }
  if (p.bombs.length && p.oppMin <= 5) return { cards: p.bombs[0].cards };
  return { pass: true };
}

function chooseL2(m, seat, g, wv) {
  if (!m.leaderCombo) return leadPlay(m, seat, g, wv);
  return followL2(followPre(m, seat, g, wv));
}

/* ── 档位 0（普通）：休闲——领出最小单张；跟牌只打廉价同型；绝不用炸 ── */
function chooseL0(m, seat, g, wv) {
  if (!m.leaderCombo) {
    const s = minSingle(g);
    return s ? { cards: [s] } : { pass: true };
  }
  const p = followPre(m, seat, g, wv);
  const c = p.cheap[0];
  if (c && (c.combo.power === 1 || c.combo.main <= 10)) return { cards: c.cards };
  return { pass: true };
}

/* ── 档位 1（进阶）：烧牌领出、廉价跟牌；仅对手收尾(≤2 张)时上最强炸，不抢炸 ── */
function chooseL1(m, seat, g, wv) {
  if (!m.leaderCombo) {
    const opts = leadCandidates(g, wv);
    if (opts.length) {
      opts.sort((a, b) => b.length - a.length || (recognize(a, wv).main - recognize(b, wv).main));
      return { cards: opts[0] };
    }
    const s = minSingle(g);
    return s ? { cards: [s] } : { pass: true };
  }
  const p = followPre(m, seat, g, wv);
  if (!p.cands.length) return { pass: true };
  if (p.leader === p.partner) return { pass: true };
  if (p.oppMin <= 2 && p.bombs.length) return { cards: p.bombs[p.bombs.length - 1].cards };
  if (p.cheapBest) {
    if (p.cheapBest.combo.power === 0 && p.cheapBest.combo.main >= 12 && p.oppMin > 5) return { pass: true };
    return { cards: p.cheapBest.cards };
  }
  return { pass: true };
}

/* ── 档位 3（地域）：喂牌搭档 + 藏炸控节奏 ── */

/** 喂牌：按搭档确切手牌领出，让搭档接风/收尾（地域打法）。返回 cards 数组或 null。 */
function feedLead(m, seat, g, wv) {
  const partner = partnerOf(seat);
  const pH = m.hands[partner];
  if (!pH.length || pH.length > 3) return null;
  const oppSeats = activeSeats(m).filter(s => teamOf(s) === (teamOf(seat) ^ 1));
  const oppMin = oppSeats.length ? Math.min(...oppSeats.map(s => m.hands[s].length)) : 99;
  if (oppMin <= 3) return null; // 对手收尾 → 压制优先（leadPlay 的局势逻辑接管）
  if (pH.length === 1) {
    const p0 = pH[0];
    if (p0.s !== 'J') {
      // 搭档剩一张非王牌：领出比它小的单张，搭档收风
      const s = smallestSingleBelow(g, strength(p0, wv), wv);
      return s ? [s] : null;
    }
    // 搭档持王：领大牌，对手难压，搭档王收尾
    const mx = maxSingle(g);
    return mx ? [mx] : null;
  }
  if (pH.length === 2) {
    const [a, b] = pH;
    if (a.s !== 'J' && b.s !== 'J' && a.v === b.v) {
      // 搭档剩一对：喂小对
      const pr = smallestPairBelow(g, strength(a, wv), wv);
      if (pr) return pr;
    }
    const s = minSingle(g);
    return s ? [s] : null;
  }
  return null;
}

/** 手中自然牌里力量值（本项目序：级牌=13 > A=12 … 2=0）小于 cap 的最小单张；无则 null。 */
function smallestSingleBelow(g, cap, wv) {
  let best = null, bestSt = Infinity;
  for (const v of g.byVal.keys()) {
    const st = v === wv ? 13 : v - 2;
    if (st < cap && st < bestSt) { best = g.byVal.get(v)[0]; bestSt = st; }
  }
  return best;
}
/** 比搭档对子小的最小对子（wild 补位）；无则 null。 */
function smallestPairBelow(g, cap, wv) {
  const vals = [...g.byVal.keys()].sort((a, b) => a - b);
  for (const v of vals) {
    const st = v === wv ? 13 : v - 2;
    if (st < cap && (g.byVal.get(v) || []).length >= 2) return makeSame(g, v, 2);
  }
  if (g.wilds.length >= 2) { const st = 13; if (st < cap) return g.wilds.slice(0, 2); }
  return null;
}

function chooseL3(m, seat, g, wv) {
  if (!m.leaderCombo) {
    const feed = feedLead(m, seat, g, wv);
    if (feed) return { cards: feed };
    return leadPlay(m, seat, g, wv);
  }
  const p = followPre(m, seat, g, wv);
  if (!p.cands.length) return { pass: true };
  if (p.leader === p.partner) {
    if (p.oppMin <= 2 && p.bombs.length) return { cards: p.bombs[p.bombs.length - 1].cards };
    return { pass: true };
  }
  if (p.oppMin <= 2 && p.bombs.length) return { cards: p.bombs[p.bombs.length - 1].cards };
  // 藏炸：只在真正值得时抢 4 炸（比 2 更紧：不靠"炸多"与"手牌短"触发）
  if (p.b4 && (!p.cheapAffordable || p.oppMin <= 3 || p.hand.length <= 8)) {
    return { cards: p.b4.cards };
  }
  if (p.cheapBest) {
    if (p.cheapBest.combo.power === 0 && p.cheapBest.combo.main >= 12 && p.oppMin > 4) return { pass: true };
    return { cards: p.cheapBest.cards };
  }
  if (p.bombs.length && p.oppMin <= 4) return { cards: p.bombs[0].cards };
  return { pass: true };
}

/* ── 档位 4（绝望）：领出本圈烧牌最大化前瞻；跟牌不攥大牌、提前上最强炸 ── */

/** 领出前瞻：对每个候选估算"这一圈能烧掉多少张"——
 *  烧牌数(候选长度) + 搭档能廉价接手(+3，牌权转搭档、对手还得跟)
 *  + 每个压不动的对手(+1) + 喂单收风(+2)。取最高分（同分取先枚举者，确定性）。 */
function leadLookahead(m, seat, g, wv) {
  const opts = leadCandidates(g, wv);
  const ms = minSingle(g);
  const all = [...opts, ms ? [ms] : null].filter(c => c && c.length);
  if (!all.length) return null;
  const pH = m.hands[partnerOf(seat)];
  const oppSeats = activeSeats(m).filter(s => teamOf(s) === (teamOf(seat) ^ 1));
  let best = null, bestScore = -Infinity;
  for (const cand of all) {
    const c = recognize(cand, wv);
    if (!c) continue;
    let score = cand.length; // 烧牌数
    if (pH.length && c.power < 2) {
      const pb = beatingPlays(pH, c, wv).filter(x => x.combo.power < 2);
      if (pb.length && (pb[0].combo.power === 1 || pb[0].combo.main <= 10)) score += 3;
    }
    for (const s of oppSeats) {
      if (m.hands[s].length <= 3) continue; // 收尾中的对手不参与打分（压制/配合已在别处处理）
      const ob = beatingPlays(m.hands[s], c, wv)
        .filter(x => x.combo.power < 2 && (x.combo.power === 1 || x.combo.main <= 9));
      if (!ob.length) score += 1;
    }
    if (pH.length === 1 && pH[0].s !== 'J' && c.type === TYPE.SINGLE) {
      const pSt = strength(pH[0], wv);
      const cSt = cand[0].s === 'J' ? (cand[0].v === 'B' ? 15 : 14) : strength(cand[0], wv);
      if (cSt < pSt) score += 2; // 喂单收风
    }
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best ? { cards: best } : null;
}

function chooseL4(m, seat, g, wv) {
  if (!m.leaderCombo) {
    const la = leadLookahead(m, seat, g, wv);
    if (la) return la;
    const feed = feedLead(m, seat, g, wv);
    if (feed) return { cards: feed };
    return leadPlay(m, seat, g, wv);
  }
  const p = followPre(m, seat, g, wv);
  if (!p.cands.length) return { pass: true };
  if (p.leader === p.partner) {
    if (p.oppMin <= 3 && p.bombs.length) return { cards: p.bombs[p.bombs.length - 1].cards };
    return { pass: true };
  }
  if (p.oppMin <= 3 && p.bombs.length) return { cards: p.bombs[p.bombs.length - 1].cards }; // 比 2 提前一档上炸
  if (p.cheapBest) return { cards: p.cheapBest.cards }; // 绝望不攥 A/级牌——大牌就是工具
  if (p.b4 && p.oppMin <= 4) return { cards: p.b4.cards };
  if (p.bombs.length && p.oppMin <= 5) return { cards: p.bombs[0].cards };
  return { pass: true };
}

/** 提示（UI「提示」按钮）：按当前难度档给出建议。 */
export function hint(m, seat, level = 2) {
  return choose(m, seat, level);
}

export { group, makeSame };
