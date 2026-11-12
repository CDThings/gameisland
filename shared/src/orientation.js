/**
 * 自动横屏决策层（v1.54，纯函数）：玩家反馈竖屏时纸牌堆叠难操作 → 牌桌页建议横屏。
 * 本模块只做"该给什么提示 / 用什么锁定方式 / 整桌缩放多少"的纯决策，
 * 浏览器 API（screen.orientation.lock、requestFullscreen）由 UI 层（OrientationGate.vue）执行。
 * 无 DOM 依赖 → 单测可钉死行为矩阵，UI 只是执行器。
 */

/**
 * 横屏需求判定：牌桌页在"窄屏 + 竖屏"时建议横屏；宽屏（桌面）与横屏一律不提示。
 * @param {{ vw: number, vh: number, isTable: boolean, locked?: boolean }} p
 *   vw/vh 视口（CSS px，可用 innerWidth/innerHeight 或 matchMedia 结果）；isTable 是否牌桌页；
 *   locked 当前是否已锁定横屏（锁定态不再提示）
 * @param {{ maxPortraitW?: number, minLandscapeW?: number }} [opts] 竖屏判宽上限 / 横屏判宽下限
 * @returns {{ needRotate: boolean, reason: string }}
 */
export function orientationPlan(p, opts = {}) {
  const { vw, vh, isTable, locked = false } = p;
  const maxPortraitW = opts.maxPortraitW ?? 820; // 手机/小平板竖屏
  const minLandscapeW = opts.minLandscapeW ?? 500; // 小横屏（如 iPhone 横屏 667+）
  if (!isTable || locked) return { needRotate: false, reason: locked ? 'locked' : 'not-table-or-locked' };
  const portrait = vh > vw;
  if (!portrait) {
    // 横屏但太窄（迷你屏）也建议——极少见，给提示即可
    if (vw < minLandscapeW) return { needRotate: true, reason: 'landscape-narrow' };
    return { needRotate: false, reason: 'landscape-ok' };
  }
  // 竖屏：窄屏（手机/小平板）才提示；宽竖屏（平板竖着/桌面窄窗口）不强劝
  if (vw <= maxPortraitW) return { needRotate: true, reason: 'portrait-narrow' };
  return { needRotate: false, reason: 'portrait-wide' };
}

/**
 * 锁定方式选择：按"浏览器能力 + 当前是否全屏"决定 UI 该走哪条路。
 *  - 'fullscreen-lock'：document.requestFullscreen 可用且 screen.orientation.lock 可用 → 先全屏再锁横屏（Android Chrome）
 *  - 'rotate-hint'：只能提示用户手动旋转（iOS Safari 无 orientation.lock）
 *  - 'none'：已是横屏/无需处理
 * @param {{ hasLock?: boolean, hasFullscreen?: boolean, orientation?: string, needRotate?: boolean }} cap
 * @returns {'fullscreen-lock' | 'rotate-hint' | 'none'}
 */
export function lockMethod(cap = {}) {
  const { hasLock = false, hasFullscreen = false, orientation = 'landscape', needRotate = false } = cap;
  if (!needRotate) return 'none';
  if (orientation === 'landscape') return 'none';
  if (hasLock && hasFullscreen) return 'fullscreen-lock';
  if (hasLock) return 'rotate-hint'; // 有 lock API 但无全屏权限/未全屏 → 锁定多半失败，降级提示
  return 'rotate-hint';
}

/**
 * 整桌缩放：短横屏（如 iPhone 横屏 375 高）时，把自然尺寸（naturalW/H，px）的牌桌缩放到
 * 同时放下宽与高，缩放在 [minScale, maxScale] 内钳位。纯函数，UI 层设 CSS transform。
 * @returns {number} 建议 scale（1=不缩放）
 */
export function fitScale(vw, vh, naturalW, naturalH, minScale = 0.5, maxScale = 1) {
  if (!(naturalW > 0) || !(naturalH > 0) || !(vw > 0) || !(vh > 0)) return 1;
  const s = Math.min(vw / naturalW, vh / naturalH);
  return Math.min(maxScale, Math.max(minScale, s));
}

/**
 * 竖屏手牌"换行摊牌"几何（掼蛋 27 张防堆叠的 shared 口径，v1.53/v1.54）：
 * 给定可用宽 availW 与牌数 n——一行放得下（单张 ≥minCardW）就一行；
 * 放不下就拆两行（⌈n/2⌉ + 余数），牌宽按较挤的一行均分并钳位 [minCardW, maxCardW]。
 * 纯函数，UI 层拿 perRow/cardW 决定 CSS（flex-wrap + 牌宽）。
 * @returns {{ perRow: number, cardW: number, rows: number, overlap: boolean }}
 */
export function handWrapGeometry(availW, cardCount, minCardW = 18, maxCardW = 64) {
  if (!(availW > 0) || cardCount < 1) return { perRow: cardCount || 1, cardW: availW || 0, rows: cardCount || 1, overlap: false };
  const oneRowW = availW / cardCount;
  if (oneRowW >= minCardW) {
    // 一行放得下：均分牌宽（不超过 maxCardW），不重叠
    return { perRow: cardCount, cardW: Math.min(maxCardW, oneRowW), rows: 1, overlap: false };
  }
  // 一行放不下 → 两行（前 ⌈n/2⌉ 张 + 余）；牌宽按第一行均分、下限钳位 minCardW
  const perRow = Math.ceil(cardCount / 2);
  const cardW = Math.max(minCardW, Math.min(maxCardW, availW / perRow));
  // 仅当钳位后的牌宽仍大于均分份额 → 少量重叠（可读性优先）
  return { perRow, cardW, rows: 2, overlap: availW / perRow < cardW };
}

export default { orientationPlan, lockMethod, fitScale, handWrapGeometry };
