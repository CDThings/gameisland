<script setup>
// v1.54 自动横屏门禁：牌桌页竖屏时提示旋转 + Android 全屏锁定横屏（screen.orientation.lock），
// iOS 无 lock API → 降级为手动旋转提示；极矮横屏（<380）对 .gtable 整桌 zoom 适配。
// 决策纯函数在 @space/shared/orientation（orientationPlan/lockMethod/fitScale），本组件只是执行器。
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { orientationPlan, lockMethod, fitScale } from '@space/shared/orientation';

const DISMISS_KEY = 'cando.landscape.dismissed'; // 会话级：关闭后本次会话不再烦，重开页面再提示
const state = ref({ vw: 0, vh: 0, portrait: true, dismissed: false, locked: false, tried: false });
let mql = null;
let onResize = null;

onMounted(() => {
  state.value.vw = window.innerWidth;
  state.value.vh = window.innerHeight;
  state.value.portrait = window.innerHeight > window.innerWidth;
  state.value.dismissed = safeGetDismissed();
  mql = matchMedia('(orientation: portrait)');
  mql.addEventListener('change', onOrientChange);
  onResize = () => {
    state.value.vw = window.innerWidth;
    state.value.vh = window.innerHeight;
    state.value.portrait = window.innerHeight > window.innerWidth;
    syncVh();
    applyZoomFit();
  };
  window.addEventListener('resize', onResize);
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', onOrientChange);
  // v1.97 安卓 web-view 锁横屏/旋转后 100vh/100dvh 可能停留在竖屏值 → 牌桌 .table-wrap 高度错配、
  // 底部按钮被顶出可视区无法滚动。用 --vh 变量始终钉住真实视口高（牌桌页用 var(--vh,100vh)）。
  window.addEventListener('orientationchange', onResize);
  // v1.97 visualViewport（部分安卓 WebView 旋转/分屏后主 resize 不触发，用它兜底刷新 --vh）
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  syncVh();
  applyZoomFit();
});
onBeforeUnmount(() => {
  mql?.removeEventListener('change', onOrientChange);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
  if (screen.orientation?.removeEventListener) screen.orientation.removeEventListener('change', onOrientChange);
  clearZoomFit();
});

// 真实视口高（px）写进 --vh：牌桌横屏布局用它替代会滞后的 100vh/100dvh
function syncVh() {
  const el = document.documentElement;
  if (el) el.style.setProperty('--vh', window.innerHeight + 'px');
}

function safeGetDismissed() { try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } }

const plan = computed(() => orientationPlan({
  vw: state.value.vw, vh: state.value.vh, isTable: true, locked: state.value.locked,
}));
// 仅在"需要旋转 且 未关闭 且 未锁成功"时显示 banner
const visible = computed(() => plan.value.needRotate && !state.value.dismissed && !state.value.locked);

const method = computed(() => lockMethod({
  hasLock: !!(screen.orientation && screen.orientation.lock),
  hasFullscreen: !!(document.documentElement && document.documentElement.requestFullscreen),
  orientation: state.value.portrait ? 'portrait' : 'landscape',
  needRotate: plan.value.needRotate,
}));

async function tryLock() {
  state.value.tried = true;
  const doc = document.documentElement;
  try {
    // 1) 全屏（Android Chrome lock 的前提；iOS Safari 无 fullscreen API → 走手动提示）
    if (!document.fullscreenElement && doc.requestFullscreen) {
      try { await doc.requestFullscreen({ orientation: 'landscape' }); } catch { await doc.requestFullscreen(); }
    }
    // 2) 锁定横屏（仅 Android Chrome/Firefox 支持；成功 → banner 消失）
    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
      state.value.locked = true;
      applyZoomFit();
    }
    // 无 lock API（iOS）：保持 banner，用户手动旋转后 resize/orientation 事件自动隐藏
  } catch {
    // 锁定失败（用户拒绝全屏/系统限制）→ 保持提示态，不 crash
  }
}
function dismiss() {
  state.value.dismissed = true;
  try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
}

function onOrientChange() {
  // 用户手动旋转 / 系统锁生效 → 刷新视口状态；landscape 即自动隐藏
  state.value.vw = window.innerWidth;
  state.value.vh = window.innerHeight;
  state.value.portrait = window.innerHeight > window.innerWidth;
  if (!state.value.portrait) state.value.locked = true; // 已横过来 → 视为达成目标
  syncVh();
  applyZoomFit();
}

// 极矮横屏整桌 zoom（natural 1024×520 为四桌设计基准；仅 <380 高生效，下限 0.85 防缩过头）
function applyZoomFit() {
  const { vw, vh } = state.value;
  const landscape = vw > vh;
  const el = document.documentElement;
  if (landscape && vh < 380 && vw > 0) {
    const s = fitScale(vw, vh, 1024, 520, 0.85, 1);
    el.style.setProperty('--gate-zoom', String(s));
    el.classList.add('gate-zoom');
  } else clearZoomFit();
}
function clearZoomFit() {
  const el = document.documentElement;
  el.classList.remove('gate-zoom');
  el.style.removeProperty('--gate-zoom');
}
</script>

<template>
  <div v-if="visible" class="ogate">
    <span class="ogate-ico">📱↻</span>
    <span class="ogate-text">竖屏挤牌？横屏体验更好</span>
    <template v-if="method === 'fullscreen-lock'">
      <button class="ogate-btn" @click="tryLock">{{ state.tried ? '重新锁定' : '锁定横屏' }}</button>
    </template>
    <span v-else class="ogate-hint">请手动旋转手机</span>
    <button class="ogate-x" title="本次不再提示" @click="dismiss">×</button>
  </div>
</template>

<style scoped>
.ogate {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px calc(6px + env(safe-area-inset-top));
  background: rgba(16, 38, 30, .92); backdrop-filter: blur(6px);
  border-bottom: 1px solid rgba(242, 178, 27, .35);
  color: #f1faee; font-size: 12.5px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .35);
}
.ogate-ico { font-size: 15px; }
.ogate-text { flex: 1; color: var(--txt-dim, #c3dccd); }
.ogate-btn {
  background: #f2b21b; color: #3a2c00; border: 0; border-radius: 6px;
  padding: 5px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer;
}
.ogate-hint { color: #ffe8b3; font-size: 12px; }
.ogate-x {
  background: transparent; border: 0; color: #c3dccd; font-size: 18px;
  cursor: pointer; padding: 0 4px; line-height: 1;
}
.ogate-x:hover { color: #fff; }
</style>
