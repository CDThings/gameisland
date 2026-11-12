<script setup>
// v1.94 打地鼠：30 秒限时，敲中 +1 / 金地鼠 +3，漏掉不惩罚（孩子向：只有正向反馈）。
// 纯本地零 API；冒烟钩子 window.__cando.kidGame = G。
import { onBeforeUnmount, reactive, ref } from 'vue';
import { sfx } from '../ui/sfx.js';

const emit = defineEmits(['finish']);

const ROUND_SEC = 30;
const G = reactive({
  phase: 'idle',            // idle | playing | over
  score: 0,
  timeLeft: ROUND_SEC,
  slots: Array.from({ length: 9 }, () => ({ up: false, gold: false, hit: false })),
  combo: 0,
});
const floats = ref([]);     // 飘分 { id, slot, text, gold }
let floatId = 1;
let spawnTimer = null, tickTimer = null, alive = true;

function start() {
  G.phase = 'playing';
  G.score = 0;
  G.timeLeft = ROUND_SEC;
  G.combo = 0;
  G.slots.forEach(s => { s.up = false; s.gold = false; s.hit = false; });
  sfx.tap();
  scheduleSpawn(500);
  tickTimer = setInterval(() => {
    if (!alive || G.phase !== 'playing') return;
    G.timeLeft -= 1;
    if (G.timeLeft <= 0) endGame();
  }, 1000);
  window.__cando = window.__cando || {};
  window.__cando.kidGame = G;
}

/** 地鼠冒头节奏：随时间推进略加速（900ms→650ms），单只存活 0.9~1.4s */
function scheduleSpawn(delay) {
  clearTimeout(spawnTimer);
  spawnTimer = setTimeout(() => {
    if (!alive || G.phase !== 'playing') return;
    const idle = G.slots.map((s, i) => (s.up ? -1 : i)).filter(i => i >= 0);
    if (idle.length) {
      const i = idle[Math.floor(Math.random() * idle.length)];
      const gold = Math.random() < 0.12;
      const slot = G.slots[i];
      slot.up = true; slot.gold = gold; slot.hit = false;
      const life = 900 + Math.random() * 500;
      setTimeout(() => { if (alive && !slot.hit) { slot.up = false; slot.gold = false; } }, life);
    }
    const speedup = Math.max(0, ROUND_SEC - G.timeLeft) / ROUND_SEC;
    scheduleSpawn(650 + Math.random() * 400 - speedup * 250);
  }, delay);
}

function whack(i) {
  if (G.phase !== 'playing') return;
  const slot = G.slots[i];
  if (!slot.up || slot.hit) return;
  slot.hit = true;
  slot.up = false;
  const gain = slot.gold ? 3 : 1;
  G.score += gain;
  if (slot.gold) sfx.score(); else sfx.ding();
  sfx.buzz(slot.gold ? 32 : 14); // v1.97 命中轻震，金鼠重一点
  const id = floatId++;
  floats.value.push({ id, slot: i, text: '+' + gain, gold: slot.gold });
  setTimeout(() => { floats.value = floats.value.filter(f => f.id !== id); }, 700);
  slot.gold = false;
}

function endGame() {
  if (G.phase !== 'playing') return;
  G.phase = 'over';
  clearInterval(tickTimer);
  clearTimeout(spawnTimer);
  G.slots.forEach(s => { s.up = false; s.gold = false; });
  const score = G.score;
  emit('finish', {
    title: score > 0 ? '敲得真棒！' : '手痒了吗？',
    score,
    stars: score >= 25 ? 3 : score >= 12 ? 2 : 1,
    win: score > 0,
    value: score,
    sub: `30 秒敲到 ${score} 只${score >= 25 ? '，地鼠都怕你！' : score >= 12 ? '，眼睛真尖！' : '，再来练练手'}`,
  });
}

onBeforeUnmount(() => {
  alive = false;
  clearInterval(tickTimer);
  clearTimeout(spawnTimer);
});
</script>

<template>
  <div class="whack">
    <!-- 顶部计时/分数 -->
    <div class="w-hud" v-if="G.phase === 'playing'">
      <div class="w-chip">⏱ 时间 <b>{{ G.timeLeft }}</b>s</div>
      <div class="w-chip w-chip--score">分数 <b>{{ G.score }}</b></div>
    </div>

    <!-- 地鼠场 -->
    <div class="w-field" v-if="G.phase !== 'idle'">
      <div class="w-hole" v-for="(s, i) in G.slots" :key="i">
        <div class="w-clip">
          <div class="w-mole" :class="{ up: s.up, gold: s.gold }" @pointerdown.prevent="whack(i)">
            <svg viewBox="0 0 48 48">
              <ellipse cx="24" cy="26" rx="15" ry="17" :fill="s.gold ? '#E8A24B' : '#A9825A'"/>
              <circle cx="13" cy="12" r="5" :fill="s.gold ? '#E8A24B' : '#A9825A'"/>
              <circle cx="35" cy="12" r="5" :fill="s.gold ? '#E8A24B' : '#A9825A'"/>
              <circle cx="13" cy="12" r="2.4" fill="#F2C9A8"/>
              <circle cx="35" cy="12" r="2.4" fill="#F2C9A8"/>
              <circle cx="18" cy="24" r="2.6" fill="#2F2C27"/>
              <circle cx="30" cy="24" r="2.6" fill="#2F2C27"/>
              <ellipse cx="24" cy="31" rx="4.6" ry="3.4" fill="#E0784A"/>
              <path d="M20 34.5c1.6 1.8 6.4 1.8 8 0" stroke="#2F2C27" stroke-width="1.6" fill="none" stroke-linecap="round"/>
              <g v-if="s.gold"><path d="M24 3.2l1.8 3.8 4.2.5-3.1 2.9.8 4.1-3.7-2-3.7 2 .8-4.1-3.1-2.9 4.2-.5Z" fill="#FFD43B"/></g>
            </svg>
          </div>
        </div>
        <div class="w-dirt"></div>
        <span v-for="f in floats.filter(f => f.slot === i)" :key="f.id" class="w-float" :class="{ gold: f.gold }">{{ f.text }}</span>
      </div>
    </div>

    <!-- 开始页 -->
    <div class="w-intro" v-if="G.phase === 'idle'">
      <div class="w-big-mole"><svg viewBox="0 0 48 48"><ellipse cx="24" cy="28" rx="16" ry="18" fill="#A9825A"/><circle cx="12" cy="13" r="5.5" fill="#A9825A"/><circle cx="36" cy="13" r="5.5" fill="#A9825A"/><circle cx="12" cy="13" r="2.6" fill="#F2C9A8"/><circle cx="36" cy="13" r="2.6" fill="#F2C9A8"/><circle cx="18" cy="26" r="2.8" fill="#2F2C27"/><circle cx="30" cy="26" r="2.8" fill="#2F2C27"/><ellipse cx="24" cy="33" rx="5" ry="3.6" fill="#E0784A"/><path d="M19.5 37c1.8 2 7.2 2 9 0" stroke="#2F2C27" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg></div>
      <p class="w-tip">地鼠冒头就点它，<br/>金色的地鼠加 3 分！</p>
      <button class="w-start" @click="start">开始游戏</button>
    </div>
  </div>
</template>

<style scoped>
.whack { width: 100%; max-width: 430px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.w-hud { display: flex; gap: 10px; margin-bottom: 8px; }
.w-chip {
  background: var(--hn-paper, #FFFCF7); border-radius: 999px; padding: 7px 15px;
  font-size: 14px; color: var(--hn-muted, #777168);
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
}
.w-chip b { color: var(--hn-ink, #2F2C27); font-size: 16px; }
.w-chip--score b { color: var(--hn-coral, #E0784A); }
.w-field {
  width: 100%; flex: 1 1 auto; min-height: 0; max-height: 500px;
  display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 10px;
  background: linear-gradient(180deg, #CBE6CF 0%, #B7DDBC 100%);
  border-radius: 26px; padding: 12px; box-sizing: border-box;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
}
.w-hole { position: relative; min-height: 84px; }
.w-dirt {
  position: absolute; left: 8%; right: 8%; bottom: 4px; height: 26px;
  background: #A9825A; border-radius: 50%;
  box-shadow: inset 0 -5px 0 rgba(86, 66, 43, 0.25);
}
.w-clip { position: absolute; left: 0; right: 0; top: 0; bottom: 20px; overflow: hidden; }
.w-mole {
  position: absolute; left: 12%; right: 12%; bottom: 0; height: clamp(70px, 64%, 118px);
  transform: translateY(108%); transition: transform 0.13s ease-out;
  cursor: pointer; z-index: 2;
}
.w-mole.up { transform: translateY(0); }
.w-mole svg { width: 100%; height: 100%; display: block; filter: drop-shadow(0 2px 0 rgba(86, 66, 43, 0.2)); }
.w-float {
  position: absolute; left: 50%; top: 8px; transform: translateX(-50%);
  font-size: 17px; font-weight: 900; color: var(--hn-green-deep, #397D59);
  animation: w-up 0.7s ease-out forwards; z-index: 5; pointer-events: none;
}
.w-float.gold { color: var(--hn-orange-deep, #A96D1E); font-size: 20px; }
@keyframes w-up { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -34px); } }

.w-intro { text-align: center; padding-top: 4px; }
.w-big-mole { width: 96px; height: 96px; margin: 0 auto; }
.w-big-mole svg { width: 100%; height: 100%; }
.w-tip { margin: 10px 0 0; font-size: 14px; line-height: 1.85; color: var(--hn-muted, #777168); }
/* v1.99 手机横屏：3×3 鼠洞摊开用满宽，洞体收矮保三行可见 */
@media (orientation: landscape) and (max-height: 500px) {
  .whack { max-width: 560px; }
  .w-grid { gap: 6px; max-height: none; }
  .w-hole { min-height: 56px; }
  .w-tip { margin: 5px 0 0; font-size: 12px; line-height: 1.5; }
}
.w-start {
  margin-top: 14px; border: 0; cursor: pointer;
  background: var(--hn-green, #3E9B6E); color: #fff;
  font-size: 19px; font-weight: 800; font-family: inherit;
  border-radius: 20px; padding: 15px 52px;
  box-shadow: 0 6px 0 var(--hn-green-deep, #397D59);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.w-start:active { transform: translateY(5px); box-shadow: 0 1px 0 var(--hn-green-deep, #397D59); }
</style>
