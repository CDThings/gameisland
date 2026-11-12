/**
 * 掼蛋牌模型（纯逻辑，无 UI 依赖，可被 node --test 直接测试）。
 *
 * 牌表示：
 *   普通牌  { s:'S'|'H'|'D'|'C', v:2..14, id }      (11=J 12=Q 13=K 14=A)
 *   王      { s:'J', v:'S'(小王)|'B'(大王), id }
 * 一副两副共 108 张（含 2 大王 2 小王），每人 27 张，无底牌。
 *
 * 强弱（单张/对子/三张/炸弹 比较用的"力量值"，参数 levelValue=本局级牌点值 2..14）：
 *   大王 15 > 小王 14 > 级牌 13 > A 12 > K 11 > ... > 2 0
 *   级牌 = 本局"打级方"级数对应点数；级牌比 A 大、比小王小。
 *
 * 连张牌型（顺子/三连对/钢板/同花顺）中，级牌按"自然点数"参与（不作 13）。
 */

export const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_CN = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };
const RANK_LABEL = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(v) {
  if (v === 'S') return '小王';
  if (v === 'B') return '大王';
  return RANK_LABEL[v];
}

/** 自然点数索引（连张判断用）：2→0 … A→12；王返回 null。 */
export function natureIdx(v) {
  if (v === 'S' || v === 'B') return null;
  return v - 2; // 2→0, 14(A)→12
}

/** 是否红桃级牌（逢人配/wild）。wildValue = 本局级牌点值。 */
export function isWild(card, wildValue) {
  return card.s === 'H' && card.v === wildValue;
}

/** 单张力量值（用于比较）；王 > 级牌 > A > … > 2。 */
export function strength(card, levelValue) {
  if (card.s === 'J') return card.v === 'B' ? 15 : 14;
  if (card.v === levelValue) return 13; // 级牌
  return card.v - 2; // 2→0 … A(14)→12
}

export function isJoker(card) { return card.s === 'J'; }

/** 牌的人类可读标签（调试/UI）。 */
export function cardLabel(card) {
  if (isJoker(card)) return (card.v === 'B' ? '大王' : '小王');
  return SUIT_SYM[card.s] + rankLabel(card.v);
}

/** 两副牌 108 张（含 2 大王 2 小王）。每 (花色,点值) 各 2 张。 */
export function buildDeck() {
  const deck = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const s of ['S', 'H', 'D', 'C']) {
      for (let v = 2; v <= 14; v++) deck.push({ s, v, id: id++, wild: false });
    }
    deck.push({ s: 'J', v: 'B', id: id++, wild: false }); // 大王
    deck.push({ s: 'J', v: 'S', id: id++, wild: false }); // 小王
  }
  return deck; // 108
}

/** 本局 wild（逢人配）点值 = 打级方级数。 */
export function wildValueOf(level) { return level; }

export { RANK_LABEL };
