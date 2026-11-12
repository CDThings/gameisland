/**
 * 引擎包入口（裁剪自上游 packages/shared）：
 * 只保留游戏岛用到的 rng 与牌桌筹码 meta 导出；卡牌引擎按子路径引入
 * （@space/shared/cards/guandan/engine 等），不经过本 barrel。
 */
export { fnv1a, mulberry32, stream, irange, frange, pick, devSeed, dailySeed } from './rng.js';
export { rollChips, applyChip, formatChipDisplay } from './cards/meta.js';
