/**
 * 8-bit 音效：WebAudio 方波/三角波短音（≤120ms），全部程序生成，无音频素材文件。
 * 首次用户手势后激活 AudioContext（浏览器自动播放策略）。
 *
 * 静音偏好走 env.js 存储适配层（DBX 沙箱无 localStorage）并惰性初始化——
 * 模块求值早于宿主桥水合，不能在顶层读存储。
 */
import { localGet, localSet } from '../env.js';

let ctx = null;
let mutedLoaded = false;
let muted = false;

function ensureMuted() {
  if (!mutedLoaded) {
    muted = localGet('cando.muted') === '1';
    mutedLoaded = true;
  }
  return muted;
}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, dur = 0.08, type = 'square', vol = 0.12, slideTo = null, delay = 0) {
  if (ensureMuted()) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  tap() { tone(660, 0.05, 'square', 0.08); },
  ding() { tone(1320, 0.09, 'triangle', 0.14, 1760); },
  score() { tone(988, 0.07, 'square', 0.12); tone(1319, 0.09, 'square', 0.12, null, 0.08); },
  miss() { tone(220, 0.1, 'sawtooth', 0.06, 110); },
  break_() { tone(180, 0.12, 'square', 0.1, 60); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.12, null, i * 0.09)); },
  // 触感反馈：安卓 WebView 支持 navigator.vibrate（iOS 静默忽略）；静音不关震动（触感独立于声音）
  buzz(ms = 18) {
    try { navigator.vibrate && navigator.vibrate(ms); } catch { /* 不支持则忽略 */ }
  },
  // 即时反馈四音色（牌桌出牌/翻牌/结算/炸）
  deal() { tone(520, 0.04, 'square', 0.07); tone(660, 0.05, 'square', 0.07, null, 0.05); },
  flip() { tone(880, 0.06, 'triangle', 0.1, 1400); },
  payout() { tone(660, 0.05, 'square', 0.1); tone(1320, 0.08, 'square', 0.1, null, 0.06); },
  bomb() { tone(150, 0.16, 'sawtooth', 0.2, 40); tone(90, 0.12, 'square', 0.16, 30, 0.05); },
  get muted() { return ensureMuted(); },
  setMuted(m) {
    muted = m;
    mutedLoaded = true;
    localSet('cando.muted', m ? '1' : '0');
  }
};

/** 全局点击音效钩子：任何 .pbtn / [data-sfx] 按下都出「嗒」（点击必反馈） */
export function bindTapSfx() {
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pbtn, [data-sfx]')) sfx.tap();
  }, true);
}
