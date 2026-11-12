/**
 * 掼蛋牌型识别与比较（纯逻辑，node --test 可测）。
 *
 * 牌型 type 与"炸弹层级"power（0=非炸，越大越猛）：
 *   基础牌型（单/对/三张/三带二）→ 0；连张类（顺/三连对/钢板）→ 1（仅层级标记，官方同型互压下不跨层比较）
 *   BOMB(4)=2, BOMB(5)=3, STRAIGHT_FLUSH=4, BOMB(6)=5, BOMB(7)=6, BOMB(8)=7, SKYBOMB=8
 *   （同花顺介于 5 炸与 6 炸之间；天王炸=大王×2+小王×2，最大。）
 *
 * main：同层级内比较值。
 *   - 单张/对子/三张/三带二/炸弹：力量值（级牌=13 > A=12 > K=11 … > 2=0；小王=14 大王=15）。
 *     逢人配按"对自己最有利"解读（单张最高顶到级牌=13）。
 *   - 连张（顺子/三连对/钢板/同花顺）：窗口"顶牌"自然点值；A2345 顶牌=5（A 作最小），不跨头。
 *
 * 逢人配（wild）= 红桃级牌（整副牌里共 2 张）：可顶替任意非王牌，不能成王。
 */

import { isWild } from './cards.js';

export const TYPE = {
  SINGLE: 'single', PAIR: 'pair', TRIPLE: 'triple', TRIPLE_PAIR: 'triple_pair',
  STRAIGHT: 'straight', RUNPAIRS: 'runpairs', STEELPLATE: 'steelplate',
  BOMB: 'bomb', STRAIGHT_FLUSH: 'straight_flush', SKYBOMB: 'skybomb'
};

export const TYPE_CN = {
  single: '单张', pair: '对子', triple: '三张', triple_pair: '三带二',
  straight: '顺子', runpairs: '三连对', steelplate: '钢板',
  bomb: '炸弹', straight_flush: '同花顺', skybomb: '天王炸'
};

/**
 * 牌型层级（power，越大越强）—— 官方口径（TIERED_BEAT=false）：一般牌型同型同张数才可互压，炸弹压一切非炸。
 *   0  基础牌型：单张 / 对子 / 三张 / 三带二
 *   1  连张类：顺子 / 三连对 / 钢板（仅同型同张数互压，不压基础牌型）
 *   2  4 张炸    3  5 张炸    4  同花顺    5  6 张炸    6  7 张炸    7  8 张炸
 *   8  天王炸（最大）
 * （旧 TIERED_BEAT=true 变体已关闭：连张层级 1 保留仅作标记）
 */
export function powerOf(type, count) {
  if (type === TYPE.BOMB) {
    if (count === 4) return 2;
    if (count === 5) return 3;
    if (count === 6) return 5;
    if (count === 7) return 6;
    if (count === 8) return 7;
  }
  if (type === TYPE.STRAIGHT_FLUSH) return 4;
  if (type === TYPE.SKYBOMB) return 8;
  if (type === TYPE.STRAIGHT || type === TYPE.RUNPAIRS || type === TYPE.STEELPLATE) return 1;
  return 0;
}

/** 点值的力量值（比较用）：级牌=13，A=12，K=11 … 2=0。 */
function strengthOf(val, wildValue) {
  return val === wildValue ? 13 : val - 2;
}

// 连张窗口：常规 [lo..lo+k-1]（顶牌 lo+k-1）+ A-low 特例（A 作最小，顶牌为链尾）
function windowsOf(k, alowTop) {
  const ws = [];
  for (let lo = 2; lo + k - 1 <= 14; lo++) {
    const vals = new Set(); for (let v = lo; v < lo + k; v++) vals.add(v);
    ws.push({ vals, top: lo + k - 1 });
  }
  const aLow = new Set([14]); for (let v = 2; v < alowTop + 1; v++) aLow.add(v);
  ws.push({ vals: aLow, top: alowTop });
  return ws;
}
const WIN5 = windowsOf(5, 5);   // …10JQKA, A2345
const WIN3 = windowsOf(3, 3);   // …JKQ, A23
const WIN2 = windowsOf(2, 2);   // …KA, A2

function findWindow(vals, windows) {
  const set = new Set(vals);
  let best = null;
  for (const w of windows) if ([...set].every(v => w.vals.has(v))) {
    if (!best || w.top > best.top) best = w; // 取顶牌最高的窗口（wild 取最强解读）
  }
  return best;
}

function tally(cards, wildValue) {
  const byVal = new Map();
  let wild = 0, big = 0, small = 0;
  for (const c of cards) {
    if (c.s === 'J') { if (c.v === 'B') big++; else small++; continue; }
    if (isWild(c, wildValue)) { wild++; continue; }
    byVal.set(c.v, (byVal.get(c.v) || 0) + 1);
  }
  return { byVal, wild, big, small };
}

/** 识别一组牌（取最强解读）。返回 {type, main, power, [count]} 或 null。 */
export function recognize(cards, wildValue) {
  const n = cards.length;
  if (n === 0) return null;
  const t = tally(cards, wildValue);

  // 1) 天王炸
  if (n === 4 && t.big === 2 && t.small === 2)
    return { type: TYPE.SKYBOMB, main: 99, power: 8, count: 4 };

  // 2) 炸弹：4~8 张同点（不含王；逢人配可补位）
  if (n >= 4 && n <= 8 && t.big === 0 && t.small === 0) {
    const vals = [...t.byVal.keys()];
    if (vals.length <= 1) {
      const anchor = vals[0];
      const main = anchor === undefined ? 13 : strengthOf(anchor, wildValue);
      return { type: TYPE.BOMB, main, power: powerOf(TYPE.BOMB, n), count: n };
    }
  }

  // 3) 单张（级牌任意花色=13；逢人配单张最高也顶到级牌=13，不能成王）
  if (n === 1) {
    const c = cards[0];
    const main = c.s === 'J' ? (c.v === 'B' ? 15 : 14) : strengthOf(c.v, wildValue);
    return { type: TYPE.SINGLE, main, power: 0 };
  }

  // 4) 对子 / 三张
  if (n === 2) {
    if (t.big === 2) return { type: TYPE.PAIR, main: 15, power: 0 };
    if (t.small === 2) return { type: TYPE.PAIR, main: 14, power: 0 };
    if (t.big + t.small > 0) return null;
    const vals = [...t.byVal.keys()];
    if (vals.length > 1) return null; // 无 wild 时两不同点 ≠ 对子
    const anchor = vals[0];
    const main = anchor === undefined ? 13 : strengthOf(anchor, wildValue); // 双 wild = 级牌对
    return { type: TYPE.PAIR, main, power: 0 };
  }
  if (n === 3 && t.big === 0 && t.small === 0) {
    const vals = [...t.byVal.keys()];
    if (vals.length > 1) return null;
    const anchor = vals[0];
    const main = anchor === undefined ? 13 : strengthOf(anchor, wildValue);
    return { type: TYPE.TRIPLE, main, power: 0 };
  }

  // 5) 5 张：顺子 / 同花顺 / 三带二
  if (n === 5 && t.big === 0 && t.small === 0) {
    const vals = [...t.byVal.keys()];
    const allDistinct = vals.every(v => t.byVal.get(v) === 1);
    if (allDistinct) {
      const win = findWindow(vals, WIN5);
      if (win) {
        const nonWild = cards.filter(c => !isWild(c, wildValue));
        const suits = new Set(nonWild.map(c => c.s));
        if (suits.size <= 1) return { type: TYPE.STRAIGHT_FLUSH, main: win.top, power: 4 };
        return { type: TYPE.STRAIGHT, main: win.top, power: 1 };
      }
    }
    // 三带二：3 同点 + 2 同点（wild 可补位；取主点最高的解读）
    const bases = vals;
    if (bases.length <= 2) {
      const cands = [];
      if (bases.length === 2) {
        const [a, b] = bases;
        const ca = t.byVal.get(a), cb = t.byVal.get(b);
        if (ca <= 3 && cb <= 2) cands.push(a);            // 三张=a
        if (cb <= 3 && ca <= 2) cands.push(b);            // 三张=b
      } else if (bases.length === 1 && t.wild >= 2) {
        cands.push(bases[0]); // 3 张 + 2 张都顶成该点（实体已含部分）
      }
      if (cands.length) {
        let best = cands[0];
        for (const v of cands) if (strengthOf(v, wildValue) > strengthOf(best, wildValue)) best = v;
        return { type: TYPE.TRIPLE_PAIR, main: strengthOf(best, wildValue), power: 0 };
      }
    }
    return null;
  }

  // 6) 6 张：三连对 / 钢板
  if (n === 6 && t.big === 0 && t.small === 0) {
    const vals = [...t.byVal.keys()];
    if (vals.every(v => t.byVal.get(v) <= 2)) {
      const win = findWindow(vals, WIN3);
      if (win) return { type: TYPE.RUNPAIRS, main: win.top, power: 1 };
    }
    if (vals.every(v => t.byVal.get(v) <= 3)) {
      const win = findWindow(vals, WIN2);
      if (win) return { type: TYPE.STEELPLATE, main: win.top, power: 1 };
    }
    return null;
  }

  return null;
}

/**
 * 压制模式开关（2026-09-28 起按官方规则：同型互压，TIERED_BEAT=false）。
 * 官方口径："对一般牌型而言，只有当牌型相同和总张数相同的牌，才可比较大小"
 * —— 单张只能压单张、顺子只能压顺子（比最大牌）；炸弹/同花顺/天王炸仍可压一切非同级更强。
 * 层级（炸弹阶梯）：四王(8) > 6张及以上炸(5..7) > 同花顺(4) > 5炸(3) > 4炸(2)。
 * 如需恢复"连张可压基础"的定制变体：改为 true（或调用 beatsWith(a,b,true)）。
 */
export const TIERED_BEAT = false;

/** a 是否压过 b（recognize 结果，默认按 TIERED_BEAT）。层级：基础(0) < 连张(1) < 炸(2..7) < 天王炸(8)。 */
export function beats(a, b) { return beatsWith(a, b, TIERED_BEAT); }

/** 指定压制模式的比较：tiered=true 连张可压基础；false=标准竞技（同型互压，炸压一切非炸）。 */
export function beatsWith(a, b, tiered) {
  if (!a || !b) return false;
  const pa = a.power, pb = b.power;
  if (pa <= 1 && pb <= 1) {
    // 都非炸：同型互压；tiered 时连张(1) 可压基础(0)
    if (a.type === b.type) return a.main > b.main;
    return !!(tiered && pa > pb);
  }
  if (pa !== pb) return pa > pb;
  if (pa === 8) return false; // 天王炸唯一
  // 炸弹 / 同花顺（power>=2）：同张数比主点
  return a.main > b.main;
}

/** cards 能否压过 prevCombo。 */
export function canBeat(cards, prevCombo, wildValue) {
  const c = recognize(cards, wildValue);
  return c && beats(c, prevCombo);
}

/** 连张窗口（顺子5/三连对3/钢板2，含 A-low），供 AI 枚举复用。 */
export const SEQ_WINDOWS = { 5: WIN5, 3: WIN3, 2: WIN2 };
