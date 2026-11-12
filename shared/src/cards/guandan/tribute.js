/**
 * 掼蛋 进贡 / 还贡 / 抗贡（纯逻辑，node --test 可测）——官方规则口径：
 *   - 非双下：只有末游（下游者）向头游（上游者）进贡一张；进贡完成后由下游者（末游）先出牌。
 *   - 抗贡：非双下=末游持 2 大王 → 免贡，由上游者（头游）先出；双下=两家合计 2 大王（各一或一方俩）→ 免贡，头游先出。
 *   - 双下（双贡）：二人分别向上游方进贡（默认配对 末游→头游、三游→二游）；由贡大牌者先出。
 *   - 双贡同大：按顺时针方向进贡（换向配对 三游→头游、末游→二游），由上游者（头游）的下家先出。
 *   - 进贡牌：进贡方手中"除逢人配外最大的一张"（单张力量 大王>小王>级牌>A>…>2）。
 *   - 还贡：收贡方还一张自然点数 ≤10 的牌（没有则还最小一张，宽松处理）。
 */

import { isWild } from './cards.js';

/** 单张力量值（与 cards.strength 一致，这里独立实现避免循环引用）。 */
export function powerOf(card, wildValue) {
  if (card.s === 'J') return card.v === 'B' ? 15 : 14;
  if (card.v === wildValue) return 13; // 级牌
  return card.v - 2;
}

/** 进贡方应贡出的牌：手中除逢人配外的最大牌。 */
export function pickTribute(hand, wildValue) {
  let best = null;
  for (const c of hand) {
    if (isWild(c, wildValue)) continue;
    if (!best || powerOf(c, wildValue) > powerOf(best, wildValue)) best = c;
  }
  return best; // 理论上 hand 非空且必有非 wild 牌；兜底返回 null
}

/** 还贡牌：优先还一张自然点数 ≤10 的牌（最小者）；没有则还最小一张。 */
export function pickReturn(hand, wildValue) {
  const nonWild = hand.filter(c => !isWild(c, wildValue));
  const pool = nonWild.length ? nonWild : hand;
  let small = null;
  let smallLe10 = null;
  for (const c of pool) {
    if (!small || powerOf(c, wildValue) < powerOf(small, wildValue)) small = c;
    if (c.s !== 'J' && c.v <= 10 && (!smallLe10 || powerOf(c, wildValue) < powerOf(smallLe10, wildValue))) smallLe10 = c;
  }
  return smallLe10 || small;
}

/** 是否双下：头游与二游同队（对家）。 */
export function isDoubleDown(finishOrder) {
  return (finishOrder[0] ^ 2) === finishOrder[1];
}

/**
 * 进贡配对（官方口径）：
 *  - 非双下：仅 末游(f4)→头游(f1)。
 *  - 双下默认：末游(f4)→头游(f1)、三游(f3)→二游(f2)。
 *  - 双下同大 crossed：顺时针换向 三游(f3)→头游(f1)、末游(f4)→二游(f2)。
 */
export function tributePairs(finishOrder, crossed = false) {
  const [f1, f2, f3, f4] = finishOrder;
  if (!isDoubleDown(finishOrder)) return [{ giver: f4, receiver: f1 }];
  return crossed
    ? [{ giver: f3, receiver: f1 }, { giver: f4, receiver: f2 }]
    : [{ giver: f4, receiver: f1 }, { giver: f3, receiver: f2 }];
}

/** 是否抗贡（官方口径）：双下=三游+末游合计 2 大王；非双下=仅末游持 2 大王。 */
export function canResist(finishOrder, hands) {
  const bigs = h => h.filter(c => c.s === 'J' && c.v === 'B').length;
  return isDoubleDown(finishOrder)
    ? bigs(hands[finishOrder[2]]) + bigs(hands[finishOrder[3]]) >= 2
    : bigs(hands[finishOrder[3]]) >= 2;
}
