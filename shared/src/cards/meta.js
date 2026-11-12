/**
 * 桌面词条 chip（v1.15 Balatro 化）——纯函数，无状态，只影响结算。
 * 设计原则：seed 确定性 + 不碰 AI 决策 + 可重放一致。
 */

import { mulberry32, fnv1a } from '../rng.js';

// ── chip 定义（每个游戏独立池）─────────────────────────────────────────────────
/**
 * chip 结构：
 *   id     string  唯一键（如 'guandan_combo_10'）
 *   gameId string  所属游戏（guandan / holdem / mahjong / niuniu）
 *   name   string  显示名（中文）
 *   desc   string  效果描述
 *   effect string  类型：'mult' | 'base' | 'bonus'
 *   value  number  数值（mult=倍率，base/bonus=加分）
 *   condFn (rules) => bool 可选，条件触发（mult/base 无条件；bonus 需要条件）
 */

const GUANDAN_CHIPS = [
  { id: 'guandan_combo_5',  gameId: 'guandan',  name: '连打出击', desc: '同型连续出额外 +5%', effect: 'mult', value: 1.05 },
  { id: 'guandan_combo_10', gameId: 'guandan',  name: '连击大师', desc: '同型连续出额外 +10%', effect: 'mult', value: 1.10 },
  { id: 'guandan_bomb_15',  gameId: 'guandan',  name: '炸弹加成', desc: '炸弹局底分 +15%', effect: 'mult', value: 1.15 },
  { id: 'guandan_flow_3',   gameId: 'guandan',  name: '接风运', desc: '接风额外 +3 分', effect: 'bonus', value: 3,
    condFn: (rules) => rules && rules.lastIsRebound },
  { id: 'guandan_tribute_2',gameId: 'guandan',  name: '贡牌好运', desc: '贡牌局 +2 分', effect: 'bonus', value: 2,
    condFn: (rules) => rules && rules.hasTribute },
];

const HOLDEM_CHIPS = [
  // v1.21 修复：pair/straight/flush 三张曾漏 condFn（恒触发，与 desc 语义不符）；
  // 上下文由 holdem.applyHandChips 提供 { handRank: 0-9|null, wonOnFlop }
  { id: 'holdem_pair_5',    gameId: 'holdem',   name: '对子王', desc: '一对以上 +5%', effect: 'mult', value: 1.05,
    condFn: (rules) => rules && rules.handRank != null && rules.handRank >= 1 },
  { id: 'holdem_straight_8',gameId: 'holdem',   name: '顺子专家', desc: '顺子/同花 +8%', effect: 'mult', value: 1.08,
    condFn: (rules) => rules && (rules.handRank === 4 || rules.handRank === 5) },
  { id: 'holdem_flush_10',  gameId: 'holdem',   name: '同花怒', desc: '同花 +10%', effect: 'mult', value: 1.10,
    condFn: (rules) => rules && rules.handRank === 5 },
  { id: 'holdem_base_5',    gameId: 'holdem',   name: '保底金', desc: '每手基础 +5 分', effect: 'base', value: 5 },
  { id: 'holdem_flop_3',    gameId: 'holdem',   name: '翻牌幸运', desc: '翻牌圈胜 +3 分', effect: 'bonus', value: 3,
    condFn: (rules) => rules && rules.wonOnFlop },
];

const MAHJONG_CHIPS = [
  { id: 'mahjong_fan2',     gameId: 'mahjong',  name: '番上加番', desc: '胡牌番数 +1', effect: 'base', value: 1 },
  { id: 'mahjong_fan50',    gameId: 'mahjong',  name: '满贯运', desc: '满番(≥5) ×1.5', effect: 'mult', value: 1.5,
    condFn: (rules) => rules && rules.finalFan >= 5 },
  { id: 'mahjong_selfdraw', gameId: 'mahjong',  name: '自摸加成', desc: '自摸额外 +2 番', effect: 'bonus', value: 2,
    condFn: (rules) => rules && rules.selfDrawn },
  { id: 'mahjong_qiandui',  gameId: 'mahjong',  name: '七对好运', desc: '七对 ×1.3', effect: 'mult', value: 1.3,
    condFn: (rules) => rules && rules.isSevenPairs === true },
];

const NIUNIU_CHIPS = [
  { id: 'niuniu_nn_15',     gameId: 'niuniu',   name: '牛牛狂热', desc: '牛牛局 ×1.15', effect: 'mult', value: 1.15,
    condFn: (rules) => rules && rules.niuType === 'niuniu' },
  { id: 'niuniu_zhadan_20', gameId: 'niuniu',   name: '炸弹之夜', desc: '炸弹局 ×1.20', effect: 'mult', value: 1.20,
    condFn: (rules) => rules && rules.niuType === 'zhadan' },
  { id: 'niuniu_base_3',    gameId: 'niuniu',   name: '牛运加持', desc: '任意牛牌 +3 分', effect: 'bonus', value: 3,
    condFn: (rules) => rules && rules.niuType != null && rules.niuType !== 'none' },
  { id: 'niuniu_double',    gameId: 'niuniu',   name: '翻倍达人', desc: '翻倍后 ×1.10', effect: 'mult', value: 1.10,
    condFn: (rules) => rules && rules.doubled },
];

/** 按 gameId 查找 chip 池 */
const POOL = { guandan: GUANDAN_CHIPS, holdem: HOLDEM_CHIPS, mahjong: MAHJONG_CHIPS, niuniu: NIUNIU_CHIPS };

// ── rollChips：从池中确定性抽取 1~2 张 chip ───────────────────────────────────
/**
 * @param {string} seedStr - 决定种子（通常用 session seed 字符串）
 * @param {string} gameId  - 'guandan'|'holdem'|'mahjong'|'niuniu'
 * @returns {{id:string,name:string,desc:string,effect:string,value:number,condFn?}[]}
 */
export function rollChips(seedStr, gameId) {
  const pool = POOL[gameId];
  if (!pool) return [];
  const rng = mulberry32(fnv1a(seedStr + '|' + gameId, 0xB5AD4ECE));
  const count = rng() < 0.4 ? 1 : 2; // 60% 抽 2 张，40% 抽 1 张
  const picked = [];
  const used = new Set();
  for (let i = 0; i < count && picked.length < 2; i++) {
    const idx = Math.floor(rng() * pool.length);
    const chip = pool[idx];
    if (!used.has(chip.id)) { used.add(chip.id); picked.push(chip); }
  }
  return picked;
}

// ── applyChip：计算 chip 对结算规则的影响 ─────────────────────────────────────
/**
 * @param {object} rules   - 结算上下文（含 baseScore, finalFan 等）
 * @param {{id:string,effect:string,value:number,condFn?}[]} chips
 * @returns {{scoreBonus:number, multBonus:number, activeChips:Array}}
 */
export function applyChip(rules, chips) {
  let scoreBonus = 0;
  let multBonus = 1.0;
  const active = [];
  for (const chip of chips) {
    if (chip.condFn && !chip.condFn(rules)) continue;
    active.push(chip);
    if (chip.effect === 'mult') multBonus *= chip.value;
    else if (chip.effect === 'base') scoreBonus += chip.value;
    else if (chip.effect === 'bonus') scoreBonus += chip.value;
  }
  return { scoreBonus, multBonus, active };
}

// ── formatChipDisplay：为 UI 生成可读描述字符串 ───────────────────────────────
/**
 * @param {{id:string,name:string,effect:string,value:number}[]} chips
 * @returns {string} 如 "连击大师 ×1.10 · 接风运 +3"
 */
export function formatChipDisplay(chips) {
  if (!chips || chips.length === 0) return '';
  return chips.map((c) => {
    if (c.effect === 'mult') return `${c.name} ×${c.value}`;
    if (c.effect === 'base') return `${c.name} +${c.value}`;
    return `${c.name} +${c.value}`;
  }).join(' · ');
}
