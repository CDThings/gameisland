/**
 * 确定性随机：游戏内一切随机数由 seed 派生（⚓ADR-5 防作弊重放地基）。
 * 客户端模拟与服务端重放跑同一份代码，禁用 Math.random。
 */

/** FNV-1a 字符串哈希 → uint32 */
export function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：32bit 种子 → 确定性 PRNG 流 [0,1) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从 seed 字符串派生一条独立随机流（salt 区分游戏/子系统） */
export function stream(seedStr, salt) {
  return mulberry32(fnv1a(seedStr, fnv1a(String(salt), 0x9747b28c)));
}

export function irange(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function frange(rng, min, max) {
  return min + rng() * (max - min);
}

export function pick(rng, arr) {
  return arr[Math.max(0, Math.min(arr.length - 1, Math.floor(rng() * arr.length)))];
}

/** 开发/测试用固定 seed；生产由服务端 CSPRNG 生成 128bit hex */
export function devSeed(n) {
  return 'dev-' + String(n).padStart(6, '0');
}

/**
 * 每日挑战 seed：以日期字符串（YYYY-MM-DD，UTC+8）生成全服统一 seed。
 * 所有玩家同一天玩同一局，排行榜可比。
 * @param {string} [dateStr='今天（UTC+8）'] 格式 YYYY-MM-DD
 * @returns {string} 如 'daily:2026-10-09'
 */
export function dailySeed(dateStr) {
  if (dateStr) return 'daily:' + dateStr;
  // UTC+8 日期
  const d = new Date(Date.now() + 8 * 3600e3);
  const ymd = d.toISOString().slice(0, 10);
  return 'daily:' + ymd;
}
