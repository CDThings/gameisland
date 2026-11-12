<script setup>
// v1.94 飞行棋（多席位）：15×15 四色盘，支持 人机对战（你+3电脑）/ 2·3·4 人同屏热座（v1.94 用户需求）。
// 规则：掷 6 起飞且再掷一次；落同色格向前跳 4（不连锁）；落敌机格把敌机撞回机库；终点要正好走到。
// 纯本地零 API；冒烟钩子 window.__cando.kidGame = G。
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { sfx } from '../ui/sfx.js';

const emit = defineEmits(['finish']);

// ── 主环道 52 格（15×15，[col,row]），顺时针；四色起点 0/13/26/39，格色 = i%4 ──
const TRACK = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0],
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7],
  [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14],
  [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7],
  [0, 6],
];
const START = { p: 0, a1: 13, a2: 26, a3: 39 };
const HOME = {
  p: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  a1: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  a2: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  a3: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
};
const HANGAR = { p: [0, 0], a1: [9, 0], a2: [9, 9], a3: [0, 9] };   // 机库 6×6 左上角
const SLOT = [[1.5, 1.5], [3.9, 1.5], [1.5, 3.9], [3.9, 3.9]];
const CENTER_DONE = { p: [-0.4, -0.4], a1: [0.4, -0.4], a2: [0.4, 0.4], a3: [-0.4, 0.4] };

// 席位固定色（p=红）；同屏模式按此顺序取前 N 席，2 人取对角（p+a2）
const SIDES = [
  { id: 'p', c: '#E0784A', deep: '#B65F3B', soft: '#F8E7DF' },
  { id: 'a1', c: '#E8A24B', deep: '#A96D1E', soft: '#F9EBD8' },
  { id: 'a2', c: '#4A90C4', deep: '#3E79A5', soft: '#E4EEF6' },
  { id: 'a3', c: '#3E9B6E', deep: '#397D59', soft: '#E5F1E8' },
];
const sideMeta = id => SIDES.find(s => s.id === id);
const colorIdx = id => SIDES.findIndex(s => s.id === id);   // 与环道格色 i%4 对齐

const MODES = [
  { id: 'ai', label: '人机对战', hint: '你 vs 3 台电脑', seats: ['p', 'a1', 'a2', 'a3'], ai: ['a1', 'a2', 'a3'] },
  { id: 'p2', label: '2 人同屏', hint: '对角而战', seats: ['p', 'a2'], ai: [] },
  { id: 'p3', label: '3 人同屏', hint: '三足鼎立', seats: ['p', 'a1', 'a2'], ai: [] },
  { id: 'p4', label: '4 人同屏', hint: '全家上阵', seats: ['p', 'a1', 'a2', 'a3'], ai: [] },
];

const G = reactive({
  phase: 'idle',
  mode: '',
  seats: [],           // 活跃席位 [{ id, name, c, deep, soft, ai }]
  planes: null,        // { p:[-1×4], a1:… }  -1 机库 · 0-50 环道 · 51-55 跑道 · 56 到达
  turn: 0,             // G.seats 下标
  dice: 1, rolling: false,
  pending: [],
  msg: '',
});
let aiTimer = null, flickTimer = null, nextTimer = null, alive = true;

function start(modeId) {
  const mode = MODES.find(m => m.id === modeId);
  if (!mode) return;
  let pi = 0;
  G.seats = mode.seats.map(id => {
    const s = sideMeta(id);
    const humanName = '玩家' + (++pi);
    return { id, ...s, ai: mode.ai.includes(id), name: mode.ai.includes(id) ? '电脑' : (modeId === 'ai' && id === 'p' ? '你' : humanName) };
  });
  G.mode = modeId;
  G.planes = { p: [-1, -1, -1, -1], a1: [-1, -1, -1, -1], a2: [-1, -1, -1, -1], a3: [-1, -1, -1, -1] };
  G.turn = 0; G.dice = 1; G.rolling = false; G.pending = [];
  G.phase = 'playing';
  G.msg = G.seats[0].ai ? '' : '点骰子，掷到 6 才能起飞';
  sfx.tap();
  window.__cando = window.__cando || {};
  window.__cando.kidGame = G;
  if (G.seats[0].ai) aiTimer = setTimeout(() => alive && roll(), 700);
}

// ── 规则：给定骰点，一枚棋能否动 ──
function destOf(pos, d) {
  if (pos === -1) return d === 6 ? 0 : null;
  if (pos === 56) return null;
  if (pos + d > 56) return null;         // 终点要正好
  return pos + d;
}
function legalMoves(sideId, d) {
  const out = [];
  G.planes[sideId].forEach((pos, idx) => {
    const to = destOf(pos, d);
    if (to != null) out.push({ idx, from: pos, to, d });
  });
  return out;
}

// 环道绝对格（0-50 时才有）
const absOf = (sideId, pos) => (START[sideId] + pos) % 52;

function roll() {
  if (G.phase !== 'playing' || G.rolling) return;
  G.rolling = true;
  G.pending = [];
  let n = 0;
  clearInterval(flickTimer);
  flickTimer = setInterval(() => {
    G.dice = 1 + Math.floor(Math.random() * 6);
    sfx.deal();
    if (++n >= 7) {
      clearInterval(flickTimer);
      settle();
    }
  }, 85);
}

function settle() {
  G.rolling = false;
  const seat = G.seats[G.turn];
  const moves = legalMoves(seat.id, G.dice);
  if (!moves.length) {
    G.msg = `${seat.name}掷到 ${G.dice}，走不了`;
    sfx.miss();
    nextTimer = setTimeout(() => alive && advance(false), 900);
    return;
  }
  if (!seat.ai) {
    G.pending = moves;
    G.msg = G.dice === 6 ? '掷到 6！点亮起的飞机' : '点亮起的飞机';
  } else {
    G.msg = `${seat.name}掷到 ${G.dice}`;
    aiTimer = setTimeout(() => { if (alive) aiPick(moves); }, 550);
  }
}

function aiPick(moves) {
  let best = moves[0], bestScore = -Infinity;
  const side = G.seats[G.turn].id;
  for (const m of moves) {
    let sc = m.to * 0.1 + Math.random() * 3;
    if (m.from === -1) sc += 30;                                   // 起飞
    if (m.to === 56) sc += 80;                                     // 冲线
    if (m.to >= 51) sc += 40;                                      // 进跑道
    if (m.from >= 0 && m.to <= 50) {
      if (captureTargets(side, m.to).length) sc += 100;            // 撞机
      if (absOf(side, m.to) % 4 === colorIdx(side) && m.to + 4 <= 50) sc += 20;  // 同色跳
    }
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  apply(best);
}

function captureTargets(sideId, pos) {
  const abs = absOf(sideId, pos);
  const out = [];
  for (const seat of G.seats) {
    if (seat.id === sideId) continue;
    G.planes[seat.id].forEach((p, i) => {
      if (p >= 0 && p <= 50 && absOf(seat.id, p) === abs) out.push([seat.id, i]);
    });
  }
  return out;
}

function pick(idx) {
  if (G.phase !== 'playing' || G.rolling) return;
  if (G.seats[G.turn].ai) return;
  const m = G.pending.find(x => x.idx === idx);
  if (m) apply(m);
}

function apply(m) {
  const seat = G.seats[G.turn];
  const side = seat.id;
  G.pending = [];
  G.planes[side][m.idx] = m.to;
  let texts = [];
  if (m.from === -1) { sfx.score(); texts.push('起飞！'); }

  // 撞机：把落点上的敌机全部送回机库
  if (m.to >= 0 && m.to <= 50) {
    const hits = captureTargets(side, m.to);
    if (hits.length) {
      for (const [s, i] of hits) G.planes[s][i] = -1;
      sfx.bomb();
      texts.push('撞机！敌机回机库');
    }
    // 同色跳跃（只跳一次，不连锁）
    if (m.to + 4 <= 50 && absOf(side, m.to) % 4 === colorIdx(side)) {
      G.planes[side][m.idx] = m.to + 4;
      sfx.ding();
      texts.push('同色跳 +4');
      const more = captureTargets(side, m.to + 4);
      if (more.length) {
        for (const [s, i] of more) G.planes[s][i] = -1;
        sfx.bomb();
        texts.push('落点撞机！');
      }
    }
  }
  if (m.to === 56) { sfx.score(); texts.push('到达终点！'); }
  G.lastText = texts.join(' · ');
  const d = m.d;
  G.dice = 1;

  // 胜负
  if (G.planes[side].every(p => p === 56)) return endGame(side);

  G.msg = `${seat.name}：${G.lastText || '前进了'}`;
  advance(d === 6);
}

/** 轮转到下一个活跃席位；sameAgain=掷 6 奖励再掷 */
function advance(sameAgain = false) {
  if (G.phase !== 'playing') return;
  if (!sameAgain) {
    let next = G.turn;
    for (let i = 0; i < G.seats.length; i++) {
      next = (next + 1) % G.seats.length;
      break;   // 席位无淘汰机制，直接下一席
    }
    G.turn = next;
  }
  const seat = G.seats[G.turn];
  if (sameAgain) G.msg = `${seat.name}掷到 6，再掷一次！`;
  else if (!seat.ai) G.msg = '轮到 ' + seat.name + '，点骰子';
  if (seat.ai) aiTimer = setTimeout(() => { if (alive) roll(); }, 800);
}

function endGame(winnerId) {
  G.phase = 'over';
  clearTimeout(aiTimer); clearInterval(flickTimer); clearTimeout(nextTimer);
  const seat = G.seats.find(s => s.id === winnerId);
  const win = !seat.ai;
  emit('finish', {
    title: `${seat.name}的四架飞机全到啦！`,
    win,
    stars: win ? 3 : 1,
    sub: win ? (G.mode === 'ai' ? '红队大获全胜，太厉害了！' : '笑到最后的赢家！') : '差一点点，再战一局！',
  });
}

// ── 渲染坐标 ──
const PIPS = {
  1: [[12, 12]], 2: [[8, 8], [16, 16]], 3: [[8, 8], [12, 12], [16, 16]],
  4: [[8, 8], [16, 8], [8, 16], [16, 16]], 5: [[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]],
  6: [[8, 8], [16, 8], [8, 12], [16, 12], [8, 16], [16, 16]],
};
const pips = computed(() => PIPS[G.dice] || PIPS[1]);
const planePos = computed(() => {
  if (!G.planes) return [];
  const out = [];
  for (const seat of G.seats) {
    const s = seat;
    const seen = {};
    G.planes[s.id].forEach((pos, idx) => {
      let x, y;
      if (pos === -1) {
        const [hx, hy] = HANGAR[s.id];
        [x, y] = [hx + SLOT[idx][0], hy + SLOT[idx][1]];
      } else if (pos === 56) {
        x = 7 + CENTER_DONE[s.id][0]; y = 7 + CENTER_DONE[s.id][1];
      } else if (pos >= 51) {
        const [c, r] = HOME[s.id][pos - 51];
        x = c + 0.5; y = r + 0.5;
      } else {
        const [c, r] = TRACK[absOf(s.id, pos)];
        x = c + 0.5; y = r + 0.5;
        const k = Math.round(x * 10) + ',' + Math.round(y * 10);
        seen[k] = (seen[k] || 0) + 1;
        const n = seen[k] - 1;
        if (n) { x += (n % 2 ? 0.16 : -0.16) * Math.ceil(n / 2); y += (n % 2 ? -0.14 : 0.14) * Math.ceil(n / 2); }
      }
      const movable = !s.ai && G.seats[G.turn].id === s.id && G.pending.some(m2 => m2.idx === idx);
      out.push({ key: s.id + idx, seat: s, idx, x, y, movable, pos });
    });
  }
  return out;
});
const trackCells = computed(() => TRACK.map(([c, r], i) => ({ x: c, y: r, color: SIDES[i % 4] })));
const homeCells = computed(() => SIDES.flatMap(s => HOME[s.id].map(([c, r]) => ({ x: c, y: r, s }))));
const hangars = computed(() => SIDES.map(s => ({ s, x: HANGAR[s.id][0], y: HANGAR[s.id][1] })));
const curSeat = computed(() => G.seats[G.turn] || SIDES[0]);

onBeforeUnmount(() => {
  alive = false;
  clearTimeout(aiTimer); clearInterval(flickTimer); clearTimeout(nextTimer);
});
</script>

<template>
  <div class="ludo">
    <!-- 开始页：选模式 -->
    <div class="l-intro" v-if="G.phase === 'idle'">
      <p class="l-tip">掷到 <b>6</b> 起飞，掷到 6 再掷一次；落在<b>同色格</b>往前跳 4 格；<br/>追上敌机把它<b>撞回机库</b>！四架飞机全到终点获胜。</p>
      <div class="l-modes">
        <button v-for="m in MODES" :key="m.id" class="l-mode" @click="start(m.id)">
          <b>{{ m.label }}</b><span>{{ m.hint }}</span>
        </button>
      </div>
    </div>

    <template v-if="G.phase !== 'idle'">
      <!-- 回合/消息条 -->
      <div class="l-bar">
        <span class="l-turn" :style="{ background: curSeat.soft, color: curSeat.deep }">
          {{ curSeat.ai ? curSeat.name + '行动中' : '轮到 ' + curSeat.name }}
        </span>
        <span class="l-msg">{{ G.msg }}</span>
      </div>

      <!-- 棋盘 -->
      <svg class="l-board" viewBox="0 0 15 15">
        <rect x="0" y="0" width="15" height="15" rx="0.6" fill="var(--hn-paper, #FFFCF7)"/>
        <g v-for="h in hangars" :key="'h' + h.s.id">
          <rect :x="h.x" :y="h.y" width="6" height="6" rx="1" :fill="h.s.soft"/>
          <rect :x="h.x + 0.6" :y="h.y + 0.6" width="4.8" height="4.8" rx="0.8" fill="none" :stroke="h.s.c" stroke-width="0.1" opacity="0.5"/>
        </g>
        <g v-for="(t, i) in trackCells" :key="'t' + i">
          <rect :x="t.x + 0.06" :y="t.y + 0.06" width="0.88" height="0.88" rx="0.18"
            :fill="t.color.soft" :stroke="t.color.c" :stroke-width="i % 13 === 0 ? 0.16 : 0.07" opacity="0.92"/>
        </g>
        <g v-for="(h, i) in homeCells" :key="'hm' + i">
          <rect :x="h.x + 0.06" :y="h.y + 0.06" width="0.88" height="0.88" rx="0.18" :fill="h.s.c" opacity="0.85"/>
        </g>
        <g>
          <rect x="6.15" y="6.15" width="2.7" height="2.7" rx="0.4" fill="var(--hn-ink, #2F2C27)"/>
          <path d="M7.5 6.4 8.6 7.5 7.5 8.6 6.4 7.5Z" fill="var(--hn-orange, #E8A24B)"/>
        </g>
        <g v-for="pl in planePos" :key="pl.key" :transform="`translate(${pl.x}, ${pl.y})`" class="l-plane"
          @pointerdown.prevent="pl.movable && pick(pl.idx)">
          <circle v-if="pl.movable" r="0.46" fill="none" stroke="var(--hn-green, #3E9B6E)" stroke-width="0.09" class="l-ring"/>
          <circle r="0.34" :fill="pl.seat.c" :stroke="pl.seat.deep" stroke-width="0.06"/>
          <path d="M0 -0.19 0.15 0.13 0 0.05 -0.15 0.13Z" fill="#fff"/>
        </g>
      </svg>

      <!-- 骰子区 -->
      <div class="l-dice-row">
        <svg class="l-dice" :class="{ rolling: G.rolling }" viewBox="0 0 24 24">
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#fff" stroke="var(--hn-ink, #2F2C27)" stroke-width="1.6"/>
          <g fill="var(--hn-ink, #2F2C27)">
            <circle v-for="(pp, i) in pips" :key="i" :cx="pp[0]" :cy="pp[1]" r="1.7"/>
          </g>
        </svg>
        <button class="l-roll" :disabled="G.rolling || curSeat.ai || G.pending.length"
          @click="sfx.tap(); roll()">
          {{ curSeat.ai ? curSeat.name + '回合' : (G.rolling ? '…' : '掷骰子') }}
        </button>
        <button class="l-restart" @click="sfx.tap(); G.phase = 'idle'">换模式</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ludo { width: 100%; max-width: 430px; display: flex; flex-direction: column; align-items: center; }
.l-intro { text-align: center; padding-top: 2px; }
.l-tip { font-size: 14px; line-height: 1.9; color: var(--hn-muted, #777168); margin: 0 0 12px; }
.l-tip b { color: var(--hn-coral, #E0784A); }
.l-modes { display: flex; flex-direction: column; gap: 10px; width: 240px; }
.l-mode {
  border: 0; cursor: pointer; text-align: left;
  background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  border-radius: 16px; padding: 13px 18px;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  display: flex; align-items: baseline; justify-content: space-between;
  transition: transform 0.12s ease;
}
.l-mode:active { transform: scale(0.97); }
.l-mode b { font-size: 16px; font-weight: 800; }
.l-mode span { font-size: 12px; color: var(--hn-faint, #A69D91); }

.l-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; width: 100%; }
.l-turn { border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 800; white-space: nowrap; }
.l-msg { font-size: 12.5px; font-weight: 700; color: var(--hn-muted, #777168); min-height: 1em; }
.l-board { width: min(100%, calc(var(--vh, 100vh) - 160px)); touch-action: manipulation; }
.l-plane { cursor: pointer; }
.l-plane circle { transition: transform 0.22s ease; }
.l-ring { animation: l-pulse 1s ease-in-out infinite; }
@keyframes l-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }

.l-dice-row { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
.l-dice { width: 46px; height: 46px; }
.l-dice.rolling { animation: l-shake 0.12s linear infinite; }
@keyframes l-shake { 0% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } 100% { transform: rotate(-6deg); } }
.l-roll {
  border: 0; cursor: pointer; min-width: 150px;
  background: var(--hn-green, #3E9B6E); color: #fff;
  font-size: 17px; font-weight: 800; font-family: inherit;
  border-radius: 16px; padding: 13px 26px;
  box-shadow: 0 5px 0 var(--hn-green-deep, #397D59);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.l-roll:active:not(:disabled) { transform: translateY(4px); box-shadow: 0 1px 0 var(--hn-green-deep, #397D59); }
.l-roll:disabled { background: var(--hn-sand, #E9E0D3); color: var(--hn-faint, #A69D91); box-shadow: none; cursor: default; }
.l-restart {
  border: 0; cursor: pointer; border-radius: 16px; padding: 13px 16px;
  font-size: 14px; font-weight: 800; font-family: inherit;
  background: var(--hn-paper, #FFFCF7); color: var(--hn-ink, #2F2C27);
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
}
</style>
