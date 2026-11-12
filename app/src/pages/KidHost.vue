<script setup>
// v1.94 亲子小游戏共用壳：顶部（回岛/名字/战绩/静音）+ 游戏槽位 + 温柔结算弹窗。
// 零 API 纯本地；战绩存 localStorage（cando.kids.rec.<id>）。
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { KID_GAMES } from '../kids/registry.js';
import { loadKidRecord, saveKidRecord } from '../kids/registry.js';
import { sfx } from '../ui/sfx.js';

const props = defineProps({ id: String });
const route = useRoute();
const router = useRouter();

const meta = computed(() => KID_GAMES[props.id] || null);
const gameKey = ref(0);            // 重开一局 = 强制重挂游戏组件
const phase = ref('playing');      // playing | done
const result = ref(null);          // { title, sub, score, stars, win }
const record = ref(loadKidRecord(props.id));

watch(() => props.id, () => {
  record.value = loadKidRecord(props.id);
  phase.value = 'playing';
  result.value = null;
  gameKey.value += 1;
});

const recordText = computed(() => {
  const m = meta.value;
  if (!m || !m.recordType) return '';
  if (m.recordType === 'wins') return (m.recordText || '').replace('{n}', String(record.value.wins || 0));
  const n = record.value.best;
  if (n == null) return m.recordType === 'best-low' ? '还没赢过' : '还没玩过';
  return (m.recordText || '').replace('{n}', String(n));
});

/** 游戏组件统一通过 finish 事件交卷：
 *  { title, sub, score, stars, win, value }（value=要记档的数值：得分/秒数；win=是否获胜） */
function onFinish(p) {
  const m = meta.value;
  if (m?.recordType === 'best-high' && p.value != null) record.value.best = Math.max(record.value.best || 0, p.value);
  if (m?.recordType === 'best-low' && p.win && p.value != null) {
    record.value.best = record.value.best == null ? p.value : Math.min(record.value.best, p.value);
  }
  if (m?.recordType === 'wins' && p.win) record.value.wins = (record.value.wins || 0) + 1;
  saveKidRecord(props.id, record.value);
  result.value = p;
  phase.value = 'done';
  if (p.win === false) sfx.miss();
  else sfx.fanfare();
  window.__cando = window.__cando || {};
  window.__cando.kid = { id: props.id, phase: phase.value, result: p, record: record.value };
}

function again() {
  phase.value = 'playing';
  result.value = null;
  gameKey.value += 1;
  sfx.tap();
}
function back() { router.replace('/island'); } // v2.03 replace 回岛，不堆历史栈

const muted = ref(sfx.muted);
function toggleMute() { muted.value = !sfx.muted; sfx.setMuted(muted.value); }
const showRules = ref(false);
</script>

<template>
  <div class="kid">
    <template v-if="meta">
      <!-- 顶栏：回岛 / 游戏名 / 战绩 / 静音 -->
      <div class="k-top">
        <button class="k-back" @click="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
          小岛
        </button>
        <div class="k-name">
          {{ meta.name }}
          <span class="k-rec" v-if="recordText">{{ recordText }}</span>
        </div>
        <button class="k-help" @click="showRules = true" aria-label="玩法说明">
          <span class="k-help-q">?</span>
        </button>
        <button class="k-mute" :class="{ off: muted }" @click="toggleMute" aria-label="声音开关">
          <svg v-if="!muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>
        </button>
      </div>
      <div class="k-stage">
        <component :is="meta.comp" :key="gameKey" @finish="onFinish" />
      </div>

      <!-- 玩法弹层（可爱卡片：星形贴纸 + 彩点短句） -->
      <div class="k-mask" v-if="showRules" @click.self="showRules = false">
        <div class="k-modal k-modal--rules">
          <div class="k-rules-head">
            <span class="k-rules-badge">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m12 2.6 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 2.6Z"/></svg>
            </span>
            <div class="k-rules-title">{{ meta.name }}·怎么玩</div>
          </div>
          <ul class="k-rules">
            <li v-for="(r, i) in meta.rules" :key="i" class="k-rule-li">
              <i class="k-rule-dot" :class="'k-rule-dot--' + (i % 4)"></i>
              <span>{{ r }}</span>
            </li>
          </ul>
          <button class="k-btn k-btn--primary k-rules-ok" @click="showRules = false; sfx.tap()">知道啦，开始玩！</button>
        </div>
      </div>

      <!-- 结算弹窗（温柔版：无论输赢都鼓励） -->
      <div class="k-mask" v-if="phase === 'done' && result">
        <div class="k-modal">
          <div class="k-stars" v-if="result.stars">
            <svg v-for="i in 3" :key="i" class="k-star" :class="{ dim: i > result.stars }" :style="{ animationDelay: i * 0.12 + 's' }" viewBox="0 0 24 24" :fill="i <= result.stars ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3Z"/></svg>
          </div>
          <h3 class="k-title">{{ result.title }}</h3>
          <div class="k-score" v-if="result.score != null">{{ result.score }}</div>
          <p class="k-sub">{{ result.sub }}</p>
          <div class="k-row">
            <button class="k-btn k-btn--primary" @click="again">再玩一次</button>
            <button class="k-btn" @click="back">回小岛</button>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="k-missing">这个游戏还没上架哦 <button class="k-btn" @click="back">回小岛</button></div>
  </div>
</template>

<style>
/* 亲子页基调：暖纸日常（--hn-* 与岛同 token），px 单位（纯 Vite 工程 rpx 无效） */
.kid {
  position: fixed; inset: 0; overflow-y: auto;
  background: var(--hn-bg, #F0E8DC);
  color: var(--hn-ink, #2F2C27);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  display: flex; flex-direction: column;
  padding: calc(8px + env(safe-area-inset-top)) 10px calc(8px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.k-top { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.k-back {
  display: inline-flex; align-items: center; gap: 4px;
  border: 0; cursor: pointer; flex-shrink: 0;
  background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  border-radius: 999px; padding: 7px 13px 7px 10px;
  font-size: 13px; font-weight: 700;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
}
.k-back svg { width: 15px; height: 15px; }
.k-name {
  flex: 1; min-width: 0; text-align: center;
  font-size: 17px; font-weight: 800; letter-spacing: -0.01em;
  display: flex; align-items: baseline; justify-content: center; gap: 8px;
}
.k-rec {
  font-size: 11px; font-weight: 700; color: var(--hn-green-deep, #397D59);
  background: var(--hn-green-soft, #E5F1E8); border-radius: 999px; padding: 3px 9px;
  white-space: nowrap;
}
.k-mute {
  width: 34px; height: 34px; border: 0; cursor: pointer; flex-shrink: 0;
  border-radius: 999px; background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
}
.k-mute svg { width: 17px; height: 17px; }
.k-mute.off { color: var(--hn-faint, #A69D91); }
.k-help {
  width: 34px; height: 34px; border: 0; cursor: pointer; flex-shrink: 0;
  border-radius: 999px; background: var(--hn-orange-soft, #F9EBD8); color: var(--hn-orange-deep, #A96D1E);
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
}
.k-help-q { font-size: 18px; font-weight: 900; line-height: 1; transform: translateY(-1px); font-family: inherit; }

.k-stage {
  flex: 1; min-height: 0; width: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.k-missing { text-align: center; margin-top: 40vh; }
/* v1.99 手机横屏（≤500 高）：顶栏与留白收紧，舞台让给游戏主体 */
@media (orientation: landscape) and (max-height: 500px) {
  .kid { padding: 6px 12px calc(6px + env(safe-area-inset-bottom)); }
  .k-top { gap: 6px; }
  .k-back { padding: 5px 10px 5px 8px; font-size: 12px; }
  .k-name { font-size: 15px; }
  .k-rec { font-size: 10px; padding: 2px 7px; }
  .k-mute, .k-help { width: 30px; height: 30px; }
}

/* 玩法弹层（可爱卡片） */
.k-modal--rules { max-width: 330px; padding: 22px 20px 18px; text-align: left; }
.k-rules-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.k-rules-badge {
  width: 44px; height: 44px; border-radius: 16px; flex-shrink: 0;
  background: var(--hn-orange-soft, #F9EBD8); color: var(--hn-orange, #E8A24B);
  display: flex; align-items: center; justify-content: center;
  transform: rotate(-6deg);
  box-shadow: 0 4px 10px rgba(86, 66, 43, 0.1);
}
.k-rules-badge svg { width: 24px; height: 24px; }
.k-rules-title { font-size: 18px; font-weight: 900; color: var(--hn-ink, #2F2C27); letter-spacing: -0.01em; }
.k-rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
.k-rule-li { display: flex; align-items: flex-start; gap: 9px; }
.k-rule-li span { font-size: 14px; line-height: 1.65; color: var(--hn-ink, #2F2C27); font-weight: 500; }
.k-rule-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 7px; flex-shrink: 0; }
.k-rule-dot--0 { background: var(--hn-coral, #E0784A); }
.k-rule-dot--1 { background: var(--hn-blue, #4A90C4); }
.k-rule-dot--2 { background: var(--hn-green, #3E9B6E); }
.k-rule-dot--3 { background: var(--hn-orange, #E8A24B); }
.k-rules-ok { margin-top: 18px; width: 100%; }

/* 结算弹窗 */
.k-mask {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(47, 44, 39, 0.35);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.k-modal {
  width: 100%; max-width: 320px;
  background: var(--hn-paper, #FFFCF7);
  border-radius: 26px; padding: 26px 22px 20px;
  text-align: center;
  box-shadow: 0 18px 44px rgba(47, 44, 39, 0.25);
  animation: k-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes k-pop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.k-stars { display: flex; justify-content: center; gap: 6px; margin-bottom: 10px; }
.k-star { width: 34px; height: 34px; color: var(--hn-orange, #E8A24B); animation: k-star-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
.k-star.dim { color: var(--hn-line, #E7DCCB); }
@keyframes k-star-in { from { transform: scale(0) rotate(-30deg); } to { transform: scale(1) rotate(0); } }
.k-title { margin: 2px 0 0; font-size: 21px; font-weight: 800; }
.k-score { font-size: 46px; font-weight: 900; color: var(--hn-coral, #E0784A); line-height: 1.15; margin: 4px 0 0; }
.k-sub { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--hn-muted, #777168); }
.k-row { display: flex; gap: 10px; margin-top: 18px; }
.k-btn {
  flex: 1; border: 0; cursor: pointer;
  border-radius: 16px; padding: 13px 0;
  font-size: 15px; font-weight: 800; font-family: inherit;
  background: var(--hn-sand, #E9E0D3); color: var(--hn-ink, #2F2C27);
  transition: transform 0.12s ease;
}
.k-btn:active { transform: scale(0.96); }
.k-btn--primary { background: var(--hn-green, #3E9B6E); color: #fff; }
</style>
