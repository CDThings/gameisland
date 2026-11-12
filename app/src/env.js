/**
 * 存储适配层：一套同步 get/set/remove 语义，双通道后端
 *
 * - DBX 插件沙箱：UI 运行在 opaque origin 的隔离 iframe，localStorage 直接抛 SecurityError，
 *   持久化走宿主桥 window.dbxPlugin.storage（异步 Promise API，单值 256KiB / 整库 1MiB）。
 *   上层同步读写内存 Map；启动时 main.js await hydrateStorage() 从宿主灌入水合数据，
 *   写入按 300ms 防抖把全部键值整包刷回（存档打包在单键 cando.kv.v1，远小于单值上限）。
 * - 普通浏览器（本地开发）：直接透传 localStorage，行为与原版一致。
 *
 * 消费方（四牌桌续档 / 亲子战绩 / 静音偏好）保持同步调用零改动。
 */
const BLOB_KEY = 'cando.kv.v1';
const FLUSH_DELAY = 300;

const isDbx = typeof window !== 'undefined' && !!window.dbxPlugin;
const mem = new Map();
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      window.dbxPlugin.storage.set(BLOB_KEY, Object.fromEntries(mem)).catch(() => { /* 下次写再刷 */ });
    } catch { /* 桥已失效：本次会话退化为内存态 */ }
  }, FLUSH_DELAY);
}

/**
 * 从宿主灌入持久化存档（仅插件沙箱有效；须在应用挂载前 await）
 */
export async function hydrateStorage() {
  if (!isDbx) return;
  try {
    await window.dbxPlugin.ready;
    const blob = await window.dbxPlugin.storage.get(BLOB_KEY);
    if (blob && typeof blob === 'object') {
      for (const [k, v] of Object.entries(blob)) mem.set(k, v);
    }
  } catch { /* 宿主桥不可用：本次会话退化为内存态 */ }
}

/**
 * 本地存储读取
 * @param {string} key
 * @returns {string|null}
 */
export function localGet(key) {
  if (isDbx) return mem.has(key) ? mem.get(key) : null;
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * 本地存储写入
 * @param {string} key
 * @param {string} value
 */
export function localSet(key, value) {
  if (isDbx) { mem.set(key, String(value)); scheduleFlush(); return; }
  try { localStorage.setItem(key, value); } catch { /* quota 满时忽略 */ }
}

/**
 * 本地存储删除
 * @param {string} key
 */
export function localRemove(key) {
  if (isDbx) { mem.delete(key); scheduleFlush(); return; }
  try { localStorage.removeItem(key); } catch { /* 忽略 */ }
}
