/**
 * 麻将·推倒胡（单机 1 人 vs 3 AI）纯逻辑。
 *  - 136 张：万(0-8) 筒(9-17) 条(18-26) 字·东南西北中发白(27-33)，每种 ×4。
 *  - 每家 13 张，庄家 14 张先打。摸牌 → 打牌 → 他人 胡>杠>碰 优先声明 → 下家摸牌；牌墙摸尽流局。
 *  - 胡牌 = 4 组(顺/刻) + 雀头，或 七对，或 十三幺（v1.51）；推倒胡简化计番，封顶 8 番。
 *  - 副露（碰/明杠/暗杠/加杠(v1.51)）从手牌移入 melds；杠后墙尾补摸一张，补牌胡=杠上花(+1 番)。
 *  - v1.51：加杠（碰后摸到第 4 张）/ 杠上花事件与番 / 十三幺 / 清一色·混一色·全数色番 /
 *    胡牌张记录（lastWin.tile）/ 五级难度（0普通 1进阶=零回归 2高阶 3地域=暗杠加杠保听 4绝望=加权听口）。
 *  牌 id 0..33；同种 4 张用同 id 表示（手牌/牌墙按 id 计数，无需唯一 id）。
 */
import { mulberry32 } from '../rng.js';
import { rollChips, applyChip } from './meta.js';

export const TILE_CN = (() => {
  const w = ['一万','二万','三万','四万','五万','六万','七万','八万','九万'];
  const t = ['一筒','二筒','三筒','四筒','五筒','六筒','七筒','八筒','九筒'];
  const b = ['一条','二条','三条','四条','五条','六条','七条','八条','九条'];
  const z = ['东风','南风','西风','北风','红中','发财','白板'];
  return [...w, ...t, ...b, ...z];
})();

export function buildWall() {
  const wall = [];
  for (let id = 0; id < 34; id++) for (let k = 0; k < 4; k++) wall.push(id);
  return wall; // 136
}
const suitOf = id => (id < 9 ? 0 : id < 18 ? 1 : id < 27 ? 2 : 3); // 0万1筒2条3字
const isNum = id => suitOf(id) !== 3;
const cnt = tiles => { const m = {}; for (const t of tiles) m[t] = (m[t] || 0) + 1; return m; };

/** 递归拆解：剩余牌能否全组成顺/刻。 */
export function decompose(count) {
  const ids = Object.keys(count).filter(k => count[k] > 0).map(Number).sort((a, b) => a - b);
  if (!ids.length) return true;
  const t = ids[0];
  if (count[t] >= 3) { count[t] -= 3; if (decompose(count)) { count[t] += 3; return true; } count[t] += 3; }
  if (isNum(t) && suitOf(t + 2) === suitOf(t) && (count[t + 1] || 0) > 0 && (count[t + 2] || 0) > 0) {
    count[t]--; count[t + 1]--; count[t + 2]--;
    if (decompose(count)) { count[t]++; count[t + 1]++; count[t + 2]++; return true; }
    count[t]++; count[t + 1]++; count[t + 2]++;
  }
  return false;
}

/** 13 幺九牌（万/筒/条的一九 + 七字牌）：十三幺专用（v1.51）。 */
export const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
/** 14 张是否十三幺：13 种幺九各 ≥1、恰一种成对。 */
export function isThirteen(tiles) {
  if (tiles.length !== 14) return false;
  const c = cnt(tiles);
  const ids = Object.keys(c).map(Number);
  if (ids.some(id => !YAOCHU.includes(id))) return false;
  if (ids.length !== YAOCHU.length) return false; // 13 种齐
  return ids.filter(id => c[id] === 2).length === 1; // 恰一种成对
}

/** 14 张（或 13+1）能否胡：标准 4 面 1 雀 或 七对 或 十三幺（v1.51）。副露已在外部组好不计入。 */
export function canHu(tiles) {
  if (tiles.length % 3 !== 2) return false;
  if (isThirteen(tiles)) return true;
  const c = cnt(tiles);
  if (tiles.length === 14 && Object.values(c).every(n => n % 2 === 0)) return true; // 七对（含四张相同的豪华七对）
  for (const k of Object.keys(c)) {
    if (c[k] >= 2) {
      c[k] -= 2;
      const ok = decompose(c);
      c[k] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** 听牌：13 张打哪张后可胡（返回可胡的进牌）。 */
export function waits(tiles13) {
  const out = [];
  const c = cnt(tiles13);
  for (let id = 0; id < 34; id++) {
    if ((c[id] || 0) >= 4) continue;
    if (canHu([...tiles13, id])) out.push(id);
  }
  return out;
}

export function createGame(seed, humanSeat = 0, dealerOverride = null) {
  // v1.51：rng 状态存纯数据 g.rngS（mulberry32 同口径步进）→ JSON 可序列化，
  // "继续上局"中途存档后 AI 决策流与未存档局精确一致（旧实现按 seed 重导 → 中途漂移）。
  const g = { seed, rng: null, humanSeat };
  g.rngS = seed >>> 0;
  g.rng = () => stepRng(g);
  const wall = buildWall();
  for (let i = wall.length - 1; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [wall[i], wall[j]] = [wall[j], wall[i]]; }
  const dealer = dealerOverride != null ? dealerOverride : Math.floor(g.rng() * 4);
  const hands = [[], [], [], []];
  for (let r = 0; r < 13; r++) for (let p = 0; p < 4; p++) hands[p].push(wall.pop()); // 每家 13 张（修复：曾误为 4 张）
  hands[dealer].push(wall.pop()); // 庄家 14 张
  g.dealer = dealer;
  g.aiLevel = 1; // v1.51：AI 难度档（0普通/1进阶=零回归/2高阶/3地域=保听杠/4绝望=加权听口；Room/autoPlayHand 写入）
  g.hands = hands;
  g.melds = [[], [], [], []];           // [{kind:'peng'|'gang'|'jiagang', tile, from}]
  g.discards = [[], [], [], []];        // 各家弃牌（简化：各家弃牌各自记）
  g.wall = wall;
  g.turn = dealer; g.phase = 'discard'; // 摸完待打
  g.lastDiscard = null; g.lastFrom = -1;
  g.lastDrawn = [null, null, null, null]; // v1.51：各座最近摸/补的牌（胡牌张记录：自摸=补牌、天胡=14 张）
  g.claimPending = null;
  g.winner = null; g.draw = false; g.scores = [0, 0, 0, 0]; g.rounds = 0;
  g.events = [];                        // v1.39 事件流（v1.51 增 加杠/杠上花）：纯观察，不碰规则/结算/确定性
  for (const h of g.hands) sortHand(h);
  g.lastDrawn[dealer] = g.hands[dealer][13]; // 天胡的"进张"= 庄家第 14 张
  selfWinCheck(g, dealer); // 天胡：庄家起手 14 张即胡（人类庄家 → selfHuPending 等点「自摸胡」）
  return g;
}
/** mulberry32 单步（状态存 g.rngS 纯数据 → 可序列化重放；与 rng.js 的 mulberry32 流逐字节一致）。 */
function stepRng(g) {
  g.rngS = (g.rngS + 0x6d2b79f5) | 0;
  let x = g.rngS;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
export function sortHand(hand) { hand.sort((a, b) => a - b); }

function draw(g, seat) {
  if (!g.wall.length) { g.draw = true; g.phase = 'over'; g.events.push({ k: '流局' }); return null; }
  const t = g.wall.pop();
  g.hands[seat].push(t);
  sortHand(g.hands[seat]);
  g.lastDrawn[seat] = t; // v1.51：胡牌张记录（自摸/杠上花 的"进张"）
  g.turn = seat; g.phase = 'discard';
  return t;
}

function nextTurn(g, from) {
  // 声明窗口：官方优先级 胡>杠>碰；同级按「打牌者下家起逆时针」就近优先
  const t = g.lastDiscard;
  const claimers = [];
  for (const s of [0, 1, 2, 3]) {
    if (s === from || g.hands[s] === undefined) continue;
    const canP = pengable(g.hands[s], t), canG = gangable(g.hands[s], t), canH = canHu([...g.hands[s], t]);
    if (canH || canG || canP) claimers.push({ s, hu: canH, gang: canG, peng: canP });
  }
  const prio = c => (c.hu ? 0 : c.gang ? 1 : 2);
  claimers.sort((a, b) => prio(a) - prio(b) || ((a.s - from + 4) % 4) - ((b.s - from + 4) % 4));
  if (claimers.length) { g.claimPending = { tile: t, from, queue: claimers }; g.phase = 'claim'; askNext(g); return; }
  advance(g, from);
}
function askNext(g) {
  const q = g.claimPending.queue;
  if (!q.length) { const from = g.claimPending.from; g.claimPending = null; advance(g, from); return; }
  g.claimPending.cur = q[0].s;
  if (q[0].s === g.humanSeat) return; // 等玩家选择
  // AI 决策：胡必胡；听牌时不碰/不杠（保听）
  const c = q[0];
  let act = c.hu ? 'hu' : c.gang ? 'gang' : c.peng ? 'peng' : 'pass';
  if (act !== 'hu' && waits(g.hands[c.s]).length > 0) act = 'pass';
  doClaim(g, g.claimPending.cur, act);
}
export function claimOptions(g, seat) {
  if (!g.claimPending || g.claimPending.cur !== seat) return null;
  const q = g.claimPending.queue.find(x => x.s === seat);
  return { tile: g.claimPending.tile, from: g.claimPending.from, hu: q.hu, gang: q.gang, peng: q.peng };
}
export function doClaim(g, seat, action) {
  if (!g.claimPending || g.claimPending.cur !== seat) return { ok: false, reason: 'not-claiming' };
  const { tile, from } = g.claimPending;
  const q = g.claimPending.queue.find(x => x.s === seat);
  const allowed = action === 'hu' ? q.hu : action === 'gang' ? q.gang : action === 'peng' ? q.peng : true;
  if (!allowed) return { ok: false, reason: 'not-allowed' };
  if (action === 'pass') { g.claimPending.queue.shift(); askNext(g); return { ok: true }; }
  if (action === 'hu') {
    g.winner = seat; g.phase = 'over';
    const fromPool = g.discards[from];
    const fx = fromPool.lastIndexOf(tile);
    if (fx >= 0) fromPool.splice(fx, 1); // 点炮那张离开弃牌池，归入赢家手牌
    g.hands[seat].push(tile);
    scoreWin(g, seat, from, false, 10, tile); // 点炮：仅点炮者付，底分×番；v1.51 记录胡牌张
    g.events.push({ k: '点炮', s: seat, by: from, tile });
    g.claimPending = null;
    return { ok: true, hu: true };
  }
  // 碰/杠：从手牌移除，声明的那张从弃牌池取走，入 melds
  const hand = g.hands[seat];
  const fromPool = g.discards[from];
  const fx = fromPool.lastIndexOf(tile);
  if (fx >= 0) fromPool.splice(fx, 1); // 拿走声明的那张
  g.claimPending = null;
  g.lastDiscard = null; g.lastFrom = -1;
  if (action === 'peng') {
    for (let k = 0; k < 2; k++) hand.splice(hand.indexOf(tile), 1);
    g.melds[seat].push({ kind: 'peng', tile });
    g.events.push({ k: '碰', s: seat, tile });
    sortHand(hand);
    g.turn = seat; g.phase = 'discard';
    return { ok: true };
  }
  // 杠：手牌 3 张 + 声明牌成副露 → 墙尾补一张 → 检查杠上开花（修复：曾无补牌，杠家手牌 mod3 永错、永久无法胡）
  for (let k = 0; k < 3; k++) hand.splice(hand.indexOf(tile), 1);
  g.melds[seat].push({ kind: 'gang', tile });
  g.events.push({ k: '明杠', s: seat, tile });
  sortHand(hand);
  draw(g, seat); // draw 内部置 turn/phase；墙尽 → 流局
  if (g.phase === 'over') return { ok: true };
  selfWinCheck(g, seat, true); // 杠上开花（v1.51 viaGang=true → 事件「杠上花」+1 番）
  return { ok: true };
}
function advance(g, from) {
  const next = (from + 1) % 4;
  draw(g, next);
  if (g.phase === 'over') return;
  if (selfWinCheck(g, next)) return; // 自摸胡（人类 → selfHuPending 等选择）
  // AI 暗杠（档位门控，v1.51）：
  //  - 0/1/2（含默认 1=零回归）：恒暗杠、不加杠（历史行为，waits 恒空即恒杠——保留逐字节）；
  //  - 3 地域：听牌保护——当前听（摸牌后任一打张仍听）则不杠，不杠才加杠；
  //  - 4 绝望：同 3（杠/加杠策略一致，打牌走加权听口）。
  if (next !== g.humanSeat) {
    const lvl = g.aiLevel ?? 1;
    const c = cnt(g.hands[next]);
    const gangTile = Object.keys(c).find(k => c[k] === 4);
    if (lvl < 3) {
      // 历史口径：waits(14 张手牌) 恒 [] → 有 4 张即暗杠（零回归）
      if (gangTile != null && waits(g.hands[next]).length === 0) doAnGang(g, next, +gangTile);
    } else {
      const tenpaiNow = isTenpai14(g.hands[next]); // 摸牌后仍处于听（任一打张保听）
      if (gangTile != null && !tenpaiNow) doAnGang(g, next, +gangTile);
      else if (!tenpaiNow) {
        const j = g.melds[next].find(m => m.kind === 'peng' && g.hands[next].includes(m.tile));
        if (j) jiaGang(g, next, j.tile); // 加杠（补牌含杠上花检查在 jiaGang 内）
      }
    }
  }
}
/** 14 张手牌是否"仍听"：存在一张打出去后 13 张即听（保听判据，v1.51 地域/绝望档暗杠门控用）。 */
function isTenpai14(hand14) {
  for (const t of new Set(hand14)) {
    const rest = hand14.slice();
    rest.splice(rest.indexOf(t), 1);
    if (rest.length % 3 === 1 && waits(rest).length > 0) return true;
  }
  return false;
}
/** 人类加杠可选：当前打阶段、本座、无自摸胡待决时，碰副露牌手牌再有第 4 张（v1.51）。 */
export function jiaGangOptions(g, seat) {
  if (g.phase !== 'discard' || g.turn !== seat || g.selfHuPending) return [];
  const hand = g.hands[seat];
  return g.melds[seat].filter(m => m.kind === 'peng' && hand.includes(m.tile)).map(m => m.tile);
}
/** 摸牌/补牌/天胡统一自摸检查：人类座位 → selfHuPending 等玩家点「自摸胡」；AI → 直接胡结算。
 *  v1.51：viaGang=true（杠后补牌胡=杠上花，+1 番、事件区分）；tile=胡牌张（自摸=补牌张，lastDrawn 记录）。 */
export function selfWinCheck(g, seat, viaGang = false) {
  if (!canHu(g.hands[seat])) return false;
  if (seat === g.humanSeat) { g.selfHuPending = true; g.selfHuViaGang = !!viaGang; return true; }
  g.winner = seat; g.phase = 'over';
  g.events.push({ k: viaGang ? '杠上花' : '自摸', s: seat, tile: g.lastDrawn[seat] });
  scoreWin(g, seat, -1, true, 10, g.lastDrawn[seat], viaGang);
  return true;
}
function doAnGang(g, seat, tile) {
  const hand = g.hands[seat];
  for (let k = 0; k < 4; k++) hand.splice(hand.indexOf(tile), 1);
  g.melds[seat].push({ kind: 'gang', tile, concealed: true });
  g.events.push({ k: '暗杠', s: seat, tile });
  sortHand(hand);
  draw(g, seat); // 墙尾补牌
  if (g.phase === 'over') return;
  selfWinCheck(g, seat, true); // 杠上开花（暗杠补牌胡，v1.51 viaGang）
}
/**
 * v1.51 加杠：已碰（kind='peng'）的牌，手牌再凑到第 4 张时升级为杠 → 墙尾补一张（可杠上开花）。
 * 人类/ AI 均在"打阶段"（turn===seat、无自摸胡待决）主动调用；补牌检查同明杠。
 * @returns {{ ok: boolean, reason? }}
 */
export function jiaGang(g, seat, tile) {
  if (g.phase !== 'discard' || g.turn !== seat || g.selfHuPending) return { ok: false, reason: 'not-jia' };
  const hand = g.hands[seat];
  const peng = g.melds[seat].find(m => m.kind === 'peng' && m.tile === tile);
  if (!peng || hand.filter(x => x === tile).length < 1) return { ok: false, reason: 'not-jia' };
  hand.splice(hand.indexOf(tile), 1); // 4 张归副露（碰 3 + 加 1）
  peng.kind = 'jiagang';
  g.events.push({ k: '加杠', s: seat, tile });
  sortHand(hand);
  draw(g, seat);
  if (g.phase === 'over') return { ok: true };
  selfWinCheck(g, seat, true); // 加杠补牌胡=杠上开花
  return { ok: true };
}
/** 人类暗杠：当前出牌阶段手中凑满 4 张的牌（自摸胡待决时不列出）。 */
export function anGangOptions(g, seat) {
  if (g.phase !== 'discard' || g.turn !== seat || g.selfHuPending) return [];
  const c = cnt(g.hands[seat]);
  return Object.keys(c).filter(k => c[k] === 4).map(Number);
}
export function anGang(g, seat, tile) {
  if (!anGangOptions(g, seat).includes(tile)) return { ok: false, reason: 'not-allowed' };
  doAnGang(g, seat, tile);
  return { ok: true };
}

/** 打牌（当前 discard 阶段的 turn 座位）。 */
export function discard(g, seat, tile) {
  if (g.phase !== 'discard' || g.turn !== seat) return { ok: false, reason: 'not-your-turn' };
  if (g.selfHuPending && g.turn === seat) g.selfHuPending = false; // 过胡：继续打牌
  const hand = g.hands[seat];
  const ix = hand.indexOf(tile);
  if (ix < 0) return { ok: false, reason: 'not-in-hand' };
  hand.splice(ix, 1);
  g.discards[seat].push(tile);
  g.lastDiscard = tile; g.lastFrom = seat;
  g.rounds++;
  nextTurn(g, seat);
  if (g.phase === 'discard' && g.turn === seat) return { ok: false, reason: 'stalled' };
  return { ok: true };
}
export function selfHu(g, seat) {
  if (!g.selfHuPending || seat !== g.turn) return { ok: false, reason: 'no-hu' };
  const viaGang = !!g.selfHuViaGang;
  g.selfHuPending = false; g.selfHuViaGang = false;
  g.winner = seat; g.phase = 'over';
  g.events.push({ k: viaGang ? '杠上花' : '自摸', s: seat, tile: g.lastDrawn[seat] });
  scoreWin(g, seat, -1, true, 10, g.lastDrawn[seat], viaGang);
  return { ok: true, hu: true };
}

/**
 * 推倒胡计分（通行简化番表，封顶 8 番）：
 *  - 基础胡 1 番；门前清（无明副露，暗杠不破）+1；自摸 +1；杠上花（杠后补牌胡，v1.51）+1；
 *    七对 +2（含四张的豪华七对再 +1）；十三幺（v1.51）+6；
 *    碰碰胡（四组全刻/杠，无顺子）+2；
 *    色种（v1.51，三者互斥）：清一色 +2 / 混一色 +1 / 全数色 +1。
 *  - 得分 = 底分 × 番；**自摸底分 = 点炮 × 2**（联网确认口径）。
 *  - 自摸：赢家 +3×pay、三家各 -pay；点炮：赢家 +pay、点炮者 -pay。
 */
export function fanOf(g, winner, selfDrawn, viaGang = false) {
  return fanDetail(g, winner, selfDrawn, viaGang).total;
}
/**
 * 番明细（v1.52 胡牌展示面板用）：与 fanOf 同一套判定，拆出逐项 [名称, 番]——
 * 基础胡1 / 门前清+1 / 自摸+1 / 杠上花+1 / 七对+2(豪华+1) / 十三幺+6 / 碰碰胡+2 / 清一色+2 / 混一色+1 / 全数色+1，
 * total=各项和封顶 8。纯函数（关系可单测；fanOf ≡ fanDetail.total 保持钉定）。
 */
export function fanDetail(g, winner, selfDrawn, viaGang = false) {
  const out = [['基础胡', 1]];
  const melds = g.melds[winner];
  const hand = g.hands[winner];
  const vals = Object.values(cnt(hand));
  if (melds.every(m => m.concealed)) out.push(['门前清', 1]);
  if (selfDrawn) out.push(['自摸', 1]);
  if (viaGang) out.push(['杠上花', 1]);
  const isQidui = hand.length === 14 && vals.every(n => n % 2 === 0);
  if (isThirteen(hand)) {
    out.push(['十三幺', 6]);
  } else {
    if (isQidui) {
      out.push(['七对', 2]);
      if (vals.some(n => n === 4)) out.push(['豪华七对', 1]);
    }
    const openOk = melds.every(m => m.kind === 'peng' || m.kind === 'gang' || m.kind === 'jiagang');
    const groups = Math.floor((hand.length - 2) / 3);
    const concealedOk = !isQidui && melds.length + groups === 4 &&
      vals.filter(n => n === 2).length === 1 && vals.every(n => n === 2 || n === 3);
    if (openOk && concealedOk) out.push(['碰碰胡', 2]);
  }
  const all = [...hand, ...melds.map(m => m.tile)];
  const suits = new Set(all.filter(t => t < 27).map(suitOf));
  const hasHon = all.some(t => t >= 27);
  if (!hasHon && suits.size === 1) out.push(['清一色', 2]);
  else if (hasHon && suits.size === 1) out.push(['混一色', 1]);
  else if (!hasHon) out.push(['全数色', 1]);
  return { parts: out, total: Math.min(out.reduce((n, p) => n + p[1], 0), 8) };
}

export function scoreWin(g, winner, from, selfDrawn, basePoints = 10, tile = null, viaGang = false) {
  const fan = fanOf(g, winner, selfDrawn, viaGang);
  const pay = (selfDrawn ? 2 : 1) * basePoints * fan;
  if (selfDrawn) {
    g.scores[winner] += pay * 3;
    for (const s of [0, 1, 2, 3]) if (s !== winner) g.scores[s] -= pay;
  } else {
    g.scores[winner] += pay;
    g.scores[from] -= pay;
  }
  g.lastWin = { winner, from, selfDrawn, fan, pay, tile, viaGang, deltas: g.scores.slice() };
  return { fan, pay };
}
function pengable(hand, t) { return (hand.filter(x => x === t).length) >= 2; }
function gangable(hand, t) { return (hand.filter(x => x === t).length) >= 3; }

/** 打价值打分（default=历史启发式；strong=强化对子/孤字权重）。 */
function tileScore(t, c, mode) {
  let s = 0;
  const n = c[t];
  if (n >= 3) s -= 100;                                    // 刻子绝不拆
  else if (n === 2) s += mode === 'strong' ? 10 : 5;        // 对子可能是雀头（强档更舍不得拆）
  else if (!isNum(t)) s += mode === 'strong' ? 70 : 60;     // 孤字牌最先打
  else {
    const adj = (c[t - 1] && suitOf(t - 1) === suitOf(t)) || (c[t + 1] && suitOf(t + 1) === suitOf(t));
    const near = adj || (c[t - 2] && suitOf(t - 2) === suitOf(t)) || (c[t + 2] && suitOf(t + 2) === suitOf(t));
    s += adj ? 10 : near ? 25 : 45;                          // 邻张搭子 < 卡张 < 全孤
    if (t % 9 === 0 || t % 9 === 8) s += 5;                  // 边张稍优先打
  }
  return s;
}

/**
 * 加权听口（v1.51 绝望档）：waits 的每门按"剩余可见张数"加权——
 * 墙内+各家弃牌池 4 张全现 = 死听（0 分）。纯函数（同 g 状态 → 同值，确定性）。
 */
export function weightedWaits(g, seat, tiles13) {
  const visible = {};
  for (const t of g.wall) visible[t] = (visible[t] || 0) + 1;
  for (const d of g.discards.flat()) visible[d] = (visible[d] || 0) + 1;
  for (const m of g.melds.flat()) for (let k = 0; k < (m.kind === 'peng' ? 3 : 4); k++) visible[m.tile] = (visible[m.tile] || 0) + 1;
  for (const h of g.hands) for (const t of h) visible[t] = (visible[t] || 0) + 1;
  let score = 0;
  for (const w of waits(tiles13)) score += Math.max(0, 4 - (visible[w] || 0));
  return score;
}

/**
 * AI 打牌策略（v1.23 难度三档 + v1.51 五级扩展；缺省 level=1 = 历史行为等价）：
 *  - 0 普通（弱）：不保听 + 30%（g.rng）故意拆搭（打"最该留"的牌），可被稳定压制
 *  - 1 进阶（默认）：保听优先 → 打最孤的牌
 *  - 2 高阶（强）：保听 + 抢听张数（同分取剩余听口最多者；对子/孤字权重强化）
 *  - 3 地域：同 2（暗杠/加杠已带听牌保护，advance 门控）
 *  - 4 绝望：加权听口——同 2 但听口按剩余张数加权（避开死听），同分取强化打分更高者
 * 确定性：随机源用 g.rng（createGame 已消费完洗牌，后续仅本策略消费 → 同 seed 可重放）。
 */
export function aiDiscard(g, seat, level = 1) {
  const hand = g.hands[seat];
  const c = cnt(hand);
  const uniq = [...new Set(hand)];
  const tenpaiDrops = uniq.filter(t => {
    const rest = hand.slice(); rest.splice(rest.indexOf(t), 1);
    return rest.length % 3 === 1 && waits(rest).length > 0;
  });
  if (level === 0) {
    // 弱：候选=全部（不保听）；30% 故意拆搭（打价值最低=最该留的牌）
    if (g.rng && g.rng() < 0.3) {
      let bb = uniq[0], bs = 1e9;
      for (const t of uniq) { const v = tileScore(t, c, 'default'); if (v < bs) { bs = v; bb = t; } }
      return bb;
    }
  }
  if (level >= 2) {
    // 强/地域/绝望：保听（无听则全候选）+ 剩余听口最多优先，同听口比强化打分
    const pool = tenpaiDrops.length ? tenpaiDrops : uniq;
    let best = pool[0], bestWaits = -1, bestScore = -1e9;
    const waitFn = (rest) => rest.length % 3 === 1 ? (level >= 4 ? weightedWaits(g, seat, rest) : waits(rest).length) : 0;
    for (const t of pool) {
      const rest = hand.slice(); rest.splice(rest.indexOf(t), 1);
      const w = waitFn(rest);
      const s = tileScore(t, c, 'strong');
      if (w > bestWaits || (w === bestWaits && s > bestScore) || (w === bestWaits && s === bestScore && t > best)) {
        best = t; bestWaits = w; bestScore = s;
      }
    }
    return best;
  }
  // level 1（默认）：历史行为——保听优先 → 打最孤的牌
  const candidates = tenpaiDrops.length ? tenpaiDrops : uniq;
  let best = candidates[0], bestScore = -1e9;
  for (const t of candidates) {
    const s = tileScore(t, c, 'default');
    if (s > bestScore || (s === bestScore && t > best)) { bestScore = s; best = t; }
  }
  return best;
}

/**
 * AI 声明决策（v1.23 + v1.51 五级）：'hu' | 'gang' | 'peng' | 'pass'。
 *  - 胡 > 杠 > 碰 > 过（规则层优先级，全难度"胡"永远跟）。
 *  - level 0 普通：只胡，不碰不杠（守门清但不懂取舍 → 简单保守）
 *  - level 1 进阶（默认）：贪婪全跟（历史 Room 行为 hu>gang>peng）
 *  - level 2 高阶：门清/听牌保护——已听时不碰不杠（保听优先），未听才跟
 *  - level 3/4 地域/绝望：同 2（声明保守性一致；差异在打牌加权与 advance 的杠门控）
 */
export function aiClaimDecision(g, seat, level = 1) {
  const o = claimOptions(g, seat);
  if (!o) return 'pass';
  if (o.hu) return 'hu';
  if (level === 0) return 'pass';
  if (level >= 2) {
    const hand = g.hands[seat];
    const tenpai = hand.length % 3 === 1 && waits(hand).length > 0;
    if (tenpai) return 'pass'; // 已听：碰/杠会破坏门清与听口
  }
  return o.gang ? 'gang' : o.peng ? 'peng' : 'pass';
}

/** AI 整手行动（摸牌后打牌由外部调 aiDiscard；声明阶段 askNext 已自动）。 */
export function gameover(g) { return g.phase === 'over'; }

/**
 * v1.25 当前轮提示（对齐掼蛋 turn-hint / 座位高亮）：纯函数，按对局状态给
 * { activeSeat, kind }，供 HUD 高亮当前行动座 + 渲染提示文案（Room 负责文案映射）。
 * kind ∈ your-turn(activeSeat=humanSeat) | ai-turn | settling | done | idle。
 */
export function turnHint(g) {
  if (!g) return { activeSeat: -1, kind: 'idle' };
  if (g.phase === 'over') return { activeSeat: -1, kind: 'done' };
  let seat;
  if (g.phase === 'claim') seat = g.claimPending ? g.claimPending.cur : -1;
  else if (g.phase === 'discard') seat = g.turn;
  else return { activeSeat: -1, kind: 'settling' };
  if (seat == null || seat < 0 || seat > 3) return { activeSeat: -1, kind: 'settling' };
  return { activeSeat: seat, kind: seat === g.humanSeat ? 'your-turn' : 'ai-turn' };
}

/**
 * v1.29 自动打完一手（掼蛋 S.auto 的共享可测核心）：所有座位（含人类）都按 AI 决策
 * （aiDiscard/aiClaimDecision，难度 level），确定性（摸牌走 g.rng，同 seed 可重放）。
 * 供 UI"自动打完本场"逐步驱动 & 单测"整场跑完"验证。返回终局 g。
 */
export function autoPlayHand(g, level = 1) {
  g.aiLevel = level; // v1.51：写入档位 → advance 内 AI 暗杠/加杠走同档门控（默认 1=零回归）
  let guard = 0;
  while (!gameover(g) && guard++ < 100000) {
    if (g.phase === 'claim') {
      const cur = g.claimPending.cur;
      doClaim(g, cur, aiClaimDecision(g, cur, level));
    } else if (g.phase === 'discard') {
      if (g.selfHuPending) { selfHu(g, g.turn); break; }
      discard(g, g.turn, aiDiscard(g, g.turn, level));
    } else break; // 未知相防御性终止
  }
  return g;
}
/**
 * v1.37 各家听口数（掼蛋"报牌"的麻将等价：谁在听、听几张）：对每家 13 张稳定手牌，
 * 用 waits 数出"再摸到即胡"的进牌门数。纯函数，计数与 waits 自洽、终局全 0。
 * @returns {{ counts: number[], tenpai: number[] }}
 */
export function listenForAll(g) {
  const counts = [0, 0, 0, 0];
  const tenpai = [];
  if (g && g.phase !== 'over') {
    for (let s = 0; s < 4; s++) {
      if (g.hands[s].length === 13) {
        counts[s] = waits(g.hands[s]).length;
        if (counts[s] > 0) tenpai.push(s);
      }
    }
  }
  return { counts, tenpai };
}

/** 自动打完整场（4 局连庄制）：startSessionHand → autoPlayHand → endSessionHand，直到 sess.over。 */
export function autoPlayMatch(sess, level = 1) {
  let guard = 0;
  while (!sess.over && guard++ < 200) {
    const g = startSessionHand(sess);
    autoPlayHand(g, level);
    endSessionHand(sess);
  }
  return sess;
}

/**
 * v1.30 打牌提示（对齐掼蛋"提示"）：推荐一张该弃的牌 + 打出后听几门（可读文案）。
 * 复用强档 aiDiscard（level）+ 既有 waits。纯函数，tile 必在手牌内、text 可单测。
 * @returns {{ tile, text, waits }}
 */
export function discardHint(g, seat, level = 2) {
  const tile = aiDiscard(g, seat, level);
  const hand = g.hands[seat];
  const rest = hand.slice();
  rest.splice(rest.indexOf(tile), 1);
  const ws = rest.length % 3 === 1 ? waits(rest) : [];
  const text = ws.length
    ? `建议打 ${TILE_CN[tile]}（打出后听 ${ws.length} 门：${ws.map(w => TILE_CN[w]).join('、')}）`
    : `建议打 ${TILE_CN[tile]}（进张最宽）`;
  return { tile, text, waits: ws };
}
/** v1.30 声明提示（对齐掼蛋"提示"）：胡/杠/碰/过 建议，复用强档 aiClaimDecision。 */
export function claimHint(g, seat, level = 2) {
  const action = aiClaimDecision(g, seat, level);
  const text = { hu: '建议胡', gang: '建议杠', peng: '建议碰', pass: '建议过' }[action] || '建议过';
  return { action, text };
}

/**
 * v1.39 本局关键事件流（对齐掼蛋 playlog / 德州下注日志 / 牛牛整场日志）：
 * 从 createGame 起在 碰/明杠/暗杠/自摸/点炮/流局 各点追加（纯观察，不碰规则/结算/确定性——
 * 不新增任何 rng 消费，同 seed 同动作序列可重放）。纯函数返回事件数组（Room 负责座名/牌名映射与裁剪）。
 * @param {object} g 单局 game
 * @returns {Array<{ k, s, by?, tile? }>}  k∈碰|明杠|暗杠|自摸|点炮|流局；s=主座；by=点炮来源；tile=涉及牌
 */
export function handLog(g) {
  return g && Array.isArray(g.events) ? g.events : [];
}

/**
 * v1.39 整场态势（对齐牛牛 scoreboard / 德州 matchStanding）：把累计分/赢局聚合为展示结构——
 * 领先者（累计分最高，同分按赢局、再按座位）/ 分差（max-min）/ 整场进度（局号/总局）/ 当前庄位。纯函数，关系可单测。
 * @param {object} sess createSession 返回
 * @returns {{ leader, totals, spread, handNo, hands, progress, over, champ, dealer, games }}
 */
export function matchBoard(sess) {
  if (!sess || !Array.isArray(sess.total)) return null;
  const total = sess.total;
  const wins = Array.isArray(sess.wins) ? sess.wins : [0, 0, 0, 0];
  let leader = 0;
  for (let i = 1; i < total.length; i++) {
    if (total[i] > total[leader] || (total[i] === total[leader] && (wins[i] > wins[leader] || (wins[i] === wins[leader] && i < leader)))) leader = i;
  }
  const max = Math.max(...total), min = Math.min(...total);
  return {
    leader,
    totals: total.slice(),
    spread: max - min,
    handNo: sess.handNo,
    hands: sess.hands,
    progress: Math.min(1, (sess.handNo || 0) / (sess.hands || 1)),
    over: !!sess.over,
    champ: sess.champ,
    dealer: sess.dealer,
    games: sess.games ? sess.games.length : 0,
  };
}

/**
 * v1.41 单机存档（对齐掼蛋 localStorage「继续上局」，目标① 产品持久化 + ③ 交互）：
 * serialize/restore round-trip。v1.51：rng 状态存 g.rngS 纯数据随 JSON 存档 →
 * 中途存档"继续上局"AI 决策流精确一致（旧实现按 seed 重导 → 中途漂移）；
 * 旧档（无 rngS）按 createGame 口径重导兜底。结构校验（损坏/篡改 → 抛错，调用方降级新开）。
 * @returns {string} JSON 存档
 */
export function serialize(sess) {
  if (!sess || !Array.isArray(sess.total)) throw new Error('bad-session');
  return JSON.stringify(sess); // g.rng（函数）被 stringify 忽略；g.rngS（纯数据）随档保留
}
/** @param {string} json serialize 产物 → 原 sess 形态（在局则 game.rng 绑定存档 rngS 状态，中途手续打可精确重放） */
export function restore(json) {
  const s = JSON.parse(json);
  if (!s || !Array.isArray(s.total) || s.total.length !== 4) throw new Error('bad-save');
  if (typeof s.handNo !== 'number' || typeof s.seed !== 'number') throw new Error('bad-save');
  const g = s.game;
  if (g && typeof g.seed === 'number') {
    if (typeof g.rngS !== 'number') g.rngS = g.seed >>> 0; // v1.41 旧档兼容
    g.rng = () => stepRng(g);
  }
  return s;
}

/**
 * 整场（4 局制，对齐线下推倒胡"四局打完一场"）：
 *  - 首局随机定庄，之后每局庄家顺时针轮转（每家轮完一次共 4 局）。
 *  - 每局记分（自摸 +3 三家各 -1；点炮 赢家 +1 点炮者 -1；流局 0 分）；
 *    sess.total 为累计分，sess.over=true 后 sess.champ 为累计分最高者（同分按赢局数、再按座位）。
 */
export function createSession(seed, humanSeat = 0, hands = 4) {
  const rng = mulberry32(seed >>> 0);
  return {
    seed, humanSeat, hands, handNo: 0, seq: 0,
    dealer: Math.floor(rng() * 4),
    total: [0, 0, 0, 0], wins: [0, 0, 0, 0], games: [],
    over: false, champ: -1, game: null,
    chips: rollChips('mahjong|' + seed, 'mahjong'),  // 桌面词条（seed 确定性）
    chipEarnings: [0, 0, 0, 0], lastHandChip: null // 旁路资助台账（不动 sess.total，零和计分不变量保持）
  };
}

/** 开一局：返回该局 game（庄家按 sess.dealer）。打完 4 局后 sess.game=null。 */
export function startSessionHand(sess) {
  if (sess.over) return null;
  sess.seq++;
  const g = createGame((sess.seed ^ Math.imul(sess.seq, 0x9E3779B1)) >>> 0, sess.humanSeat, sess.dealer);
  sess.game = g;
  return g;
}

/**
 * 桌面词条 chip 结算（v1.21，零和旁路）：
 *  - 不动 sess.total/g.scores（既有「自摸三家各付/点炮单付」零和计分不变量保持）；资助额记入 sess.chipEarnings。
 *  - 语义：赢家按局（mult 型=该局 pay×(mult−1)；base/bonus 型=面值），条件上下文
 *    { fan, finalFan, selfDrawn, isSevenPairs }。
 *  - 幂等：g.chipApplied 标记。
 */
export function applySessionChips(sess) {
  const g = sess.game;
  if (!g || !gameover(g)) return null;
  if (g.chipApplied) return sess.lastHandChip;
  g.chipApplied = true;
  const bySeat = { 0: 0, 1: 0, 2: 0, 3: 0 };
  if (g.winner == null || !g.lastWin) { sess.lastHandChip = { handNo: sess.handNo, bySeat, total: 0 }; return sess.lastHandChip; }
  const w = g.winner;
  const hand = g.hands[w];
  const c = {};
  hand.forEach(t => { c[t] = (c[t] || 0) + 1; });
  const isSevenPairs = hand.length === 14 && Object.values(c).every(n => n % 2 === 0);
  const { multBonus, scoreBonus } = applyChip(
    { fan: g.lastWin.fan, finalFan: g.lastWin.fan, selfDrawn: g.lastWin.selfDrawn, isSevenPairs },
    sess.chips || []);
  const bonus = Math.round(g.lastWin.pay * (multBonus - 1)) + scoreBonus;
  if (bonus > 0) { bySeat[w] = bonus; sess.chipEarnings[w] += bonus; }
  sess.lastHandChip = { handNo: sess.handNo, bySeat, total: bySeat[w] };
  return sess.lastHandChip;
}

/** 一局打完：累计总分、连庄/换庄（庄家胡=连庄不计数；客胡/流局=顺时针换庄、手数+1），4 局整场。 */
export function endSessionHand(sess) {
  const g = sess.game;
  if (!g || !gameover(g)) return sess;
  applySessionChips(sess); // 本局完局 → 记 chip 旁路资助（幂等；流局无赢家 → 0）
  for (let i = 0; i < 4; i++) sess.total[i] += g.scores[i];
  const dealerStay = g.winner === g.dealer; // 庄家胡（自摸或点炮）→ 连庄
  sess.games.push({ handNo: sess.handNo, dealer: g.dealer, winner: g.winner, draw: g.draw, dealerStay, scores: g.scores.slice() });
  if (g.winner != null) sess.wins[g.winner]++;
  sess.game = null;
  if (!dealerStay) {
    sess.dealer = (sess.dealer + 1) % 4; // 顺时针换庄
    sess.handNo++;
  }
  if (sess.handNo >= sess.hands) {
    sess.over = true;
    let c = 0;
    for (let i = 1; i < 4; i++) {
      if (sess.total[i] > sess.total[c] || (sess.total[i] === sess.total[c] && (sess.wins[i] > sess.wins[c] || (sess.wins[i] === sess.wins[c] && i < c)))) c = i;
    }
    sess.champ = c;
  }
  return sess;
}
