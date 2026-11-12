<script setup>
import { onMounted, onBeforeUnmount, computed } from 'vue';
import { useRoute } from 'vue-router';
import OrientationGate from './ui/OrientationGate.vue'; // 牌桌竖屏提示 + 横屏适配

const route = useRoute();

// 全局 --vh：真实视口高钉进 CSS 变量（旋转/缩放后 100dvh 常滞留旧值）。
// 页面用 var(--vh,100vh) 做几何约束；OrientationGate（牌桌）内另有同值同步，幂等。
let lastLandscape = null;

/** 强制全量重绘：body display 同步抖动（JS 任务内恢复，浏览器只在任务结束后画一帧 → 无闪烁），
 *  清掉旋转/缩放后的合成层残影（图标重复/文字缺字） */
function forceRepaint() {
  const b = document.body;
  if (!b) return;
  b.style.display = 'none';
  void b.offsetHeight;
  b.style.display = '';
}

function syncVh() {
  const el = document.documentElement;
  if (!el) return;
  el.style.setProperty('--vh', window.innerHeight + 'px');
  // 横竖切换瞬间强制全量重绘（兜底旋转后的合成层残影）
  const landscape = window.innerWidth > window.innerHeight;
  if (lastLandscape !== null && landscape !== lastLandscape) forceRepaint();
  lastLandscape = landscape;
}
const onVpResize = () => syncVh();
onMounted(() => {
  syncVh();
  window.addEventListener('resize', onVpResize);
  window.addEventListener('orientationchange', onVpResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onVpResize);
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', onVpResize);
  // 首帧后清一次残影：等首帧画完再强制全量重绘一次（420ms 足够 Vue 首渲染落定）
  setTimeout(forceRepaint, 420);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onVpResize);
  window.removeEventListener('orientationchange', onVpResize);
  if (window.visualViewport) window.visualViewport.removeEventListener('resize', onVpResize);
  if (screen.orientation?.removeEventListener) screen.orientation.removeEventListener('change', onVpResize);
});
// 四张牌桌页挂自动横屏门禁（竖屏提示旋转 + 极矮横屏 zoom 适配）
const isCardTable = computed(() => ['guandan', 'niuniu', 'holdem', 'mahjong'].includes(route.name));
</script>

<template>
  <div>
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
    <OrientationGate v-if="isCardTable" />
  </div>
</template>
