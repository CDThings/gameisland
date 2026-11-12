<script setup>
// 掼蛋牌桌页（Space 集成版）：纯逻辑在 @space/shared/cards/guandan，本页只做交互与展示
import { reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import {
  createMatch, startHand, play, pass, serialize, restore, teamOf,
  completeReturn, validReturn, sanitizeSeed
} from '@space/shared/cards/guandan/engine';
import { hint, LEVELS, levelCn } from '@space/shared/cards/guandan/ai';
import { isWild } from '@space/shared/cards/guandan/cards';
import { recognize, TYPE_CN } from '@space/shared/cards/guandan/combos';
import CardView from '../ui/cards/CardView.vue';
import SeatBlock from '../ui/cards/SeatBlock.vue';
import { sfx } from '../ui/sfx.js';
import { localGet, localSet, localRemove } from '../env.js';

const router = useRouter(); // v2.03 回岛（replace，不堆历史栈）

const SAVE_KEY = 'guandan.save.v1';
const NAMES = { 0: '你', 1: '左家·AI', 2: '搭档·AI', 3: '右家·AI' };
const SEAT_ORDER = [0, 3, 2, 1];
const HUMAN = 0;
const LEVEL_SEQ = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
// 牌池小牌（.tcard）文案：独立于 CardView，避免 .pcard 全局层叠干扰
const RK_TXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_TXT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const rankText = c => (c.s === 'J' ? (c.v === 'B' ? '大' : '小') : (RK_TXT[c.v] || c.v));
const suitText = c => (c.s === 'J' ? '★' : (SUIT_TXT[c.s] || ''));

const S = reactive({
  screen: 'menu',   // menu | table | handEnd | over
  m: null,
  sel: [],
  auto: false,
  fast: false,
  level: 2,         // AI 难度（v1.49 五级：0普通/1进阶/2高阶(默认零回归)/3地域/4绝望）
  toast: null
});
let aiTimer = 0, toastTimer = 0;

// 模板可读绑定
const m = computed(() => S.m);
const screen = computed(() => S.screen);
const auto = computed(() => S.auto);
const fast = computed(() => S.fast);
const toast = computed(() => S.toast);
const names = NAMES;

function showToast(msg, ok) {
  S.toast = { msg, ok: !!ok };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (S.toast = null), 2200);
}
const lvlLabel = v => v === 14 ? 'A' : v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : String(v);
function typeCn(cards, lv) {
  const c = recognize(cards, lv);
  return c ? TYPE_CN[c.type] : '';
}
function sortVal(c, lv) {
  if (c.s === 'J') return c.v === 'B' ? 99 : 98;
  return c.v === lv ? 90 : c.v;
}
const myCards = computed(() => {
  if (!S.m) return [];
  const lv = S.m.handLevel;
  return [...S.m.hands[HUMAN]].sort((a, b) => sortVal(a, lv) - sortVal(b, lv) || a.id - b.id);
});
const myTurn = computed(() => S.m?.phase === 'play' && S.m.turnSeat === HUMAN && !S.auto);
const inTribute = computed(() => S.m?.phase === 'tribute' && !!S.m.pendingReturn); // 等待你手动还贡
const teamName = t => (t === 0 ? '自家' : '对家');
const mustLead = computed(() => !!S.m && S.m.phase === 'play' && !S.m.leaderCombo && S.m.turnSeat === HUMAN);
const selCards = computed(() => {
  if (!S.m) return [];
  const ids = new Set(S.sel);
  return S.m.hands[HUMAN].filter(c => ids.has(c.id));
});
const sel = computed(() => S.sel); // 暴露给模板（.includes 判断选中态）

// 当前这一圈各座位的动作
const trickActions = computed(() => {
  if (!S.m) return [];
  const log = S.m.log;
  let start = 0;
  for (let i = log.length - 1; i >= 0; i--) if (log[i].type === 'trick-end' || log[i].type === 'hand') { start = i + 1; break; }
  const map = new Map();
  for (let i = start; i < log.length; i++) {
    const e = log[i];
    if (e.type === 'play') map.set(e.seat, { kind: 'play', cards: e.cards, combo: e.combo });
    else if (e.type === 'pass') map.set(e.seat, { kind: 'pass' });
  }
  return SEAT_ORDER.map(s => ({ seat: s, act: map.get(s) || null }));
});
const currentLeader = computed(() => {
  if (!S.m || !S.m.leaderCombo) return null;
  const owner = S.m.trickOwner;
  const act = trickActions.value.find(t => t.seat === owner)?.act;
  return { seat: owner, combo: S.m.leaderCombo, cards: act?.cards || [] };
});
const lastWinner = computed(() => (S.m?.lastFinish ? teamOf(S.m.lastFinish[0]) : 0));
const passActions = computed(() => trickActions.value.filter(t => t.act?.kind === 'pass'));
const leaderSeat = computed(() => currentLeader.value?.seat ?? -1);
const cellAction = (seat) => trickActions.value.find(t => t.seat === seat)?.act || null; // 该座位当前这一轮的出牌/过
const playlog = computed(() => {
  if (!S.m) return [];
  const rows = [];
  for (const e of S.m.log) {
    if (e.type === 'play') rows.push({ seat: e.seat, txt: `出 ${e.cards.length} 张`, combo: e.combo, hand: m.value?.handNo });
    else if (e.type === 'pass') rows.push({ seat: e.seat, txt: '过', combo: null });
  }
  return rows.slice(-24).reverse();
});
// 还贡：你收到的贡牌 + 应还对象
const tributeAct = computed(() => S.m?.tributeInfo?.acts?.find(a => a.receiver === HUMAN) || null);
const tributeTarget = computed(() => S.m?.pendingReturn?.to ?? -1);
const isReturnLegal = c => validReturn(S.m, c);

function teamProgress(team) {
  const lv = S.m ? S.m.teamLevels[team] : 2;
  return LEVEL_SEQ.map(x => ({ v: x, on: x <= lv }));
}

// ── 即时反馈（v1.15）：最近一条日志驱动「出牌飞入 / 炸弹震动 / 音效」，纯展示层不碰引擎时序 ──
const lastLog = computed(() => (S.m?.log?.length ? S.m.log[S.m.log.length - 1] : null));
const lastPlaySeat = computed(() => (lastLog.value?.type === 'play' ? lastLog.value.seat : -1));
const lastLogIsBomb = computed(() => {
  const t = lastLog.value?.combo?.type;
  return t === 'bomb' || t === 'straight_flush' || t === 'skybomb';
});
watch(() => S.m?.log?.length, () => {
  const e = lastLog.value;
  if (!e || e.type !== 'play' || !S.m || S.m.phase !== 'play') return;
  const t = e.combo?.type;
  if (t === 'bomb' || t === 'straight_flush' || t === 'skybomb') sfx.bomb(); else sfx.tap();
});
watch(() => S.m?.phase, (p) => {
  if (!S.m) return;
  if (p === 'handEnd') { (teamOf(S.m.lastFinish[0]) === 0 ? sfx.fanfare() : sfx.miss()); }
  else if (p === 'matchOver') { (S.m.winnerTeam === 0 ? sfx.fanfare() : sfx.miss()); }
});

// ── 动作 ──
function newMatch(seed) {
  clearTimeout(aiTimer);
  // 修复：模板 @click 会把 MouseEvent 当 seed 传入（{} >>> 0 === 0）→ 每局都发同一副牌；
  // 统一经 sanitizeSeed 归一化（非法/缺省 → 随机新 seed）。
  try {
    S.m = createMatch(sanitizeSeed(seed), HUMAN);
  } catch {
    showToast('开局失败，请重试', false);
    return;
  }
  S.sel = []; S.auto = false; S.fast = false;
  S.screen = 'table';
  sfx.deal(); // 发牌音（v1.15 即时反馈）
  save();
  // 修复：曾漏掉首次调度——首局随机先手若是 AI（3/4 概率），开局后无人出牌，看起来"没开始"
  scheduleAi();
}
function canContinue() {
  try {
    const j = localGet(SAVE_KEY); if (!j) return false;
    const mm = restore(j);
    return ['play', 'handEnd', 'tribute'].includes(mm.phase); // tribute=卡在还贡的存档也允许续打
  } catch { return false; }
}
function continueMatch() {
  try {
    const j = localGet(SAVE_KEY);
    if (!j) return;
    S.m = restore(j); S.sel = []; S.auto = false;
    S.screen = S.m.phase === 'handEnd' ? 'handEnd' : 'table';
    if (S.m.phase === 'play') scheduleAi();
  } catch {
    // 边界：存档损坏 → 清掉坏档并降级为新开局，而不是把用户卡在菜单
    try { localRemove(SAVE_KEY); } catch {}
    showToast('存档损坏，已为你新开一局', false);
    newMatch();
  }
}
function save() {
  if (!S.m) return;
  try { localSet(SAVE_KEY, serialize(S.m)); } catch {}
}
function toggleSelect(card) {
  if (inTribute.value) { S.sel = [card.id]; return; } // 还贡模式：单选
  if (!myTurn.value) return;
  const ix = S.sel.indexOf(card.id);
  if (ix >= 0) S.sel.splice(ix, 1); else S.sel.push(card.id);
}
function doReturn() {
  if (!inTribute.value) return;
  const card = S.m.hands[HUMAN].find(c => S.sel.includes(c.id));
  if (!card) { showToast('请先点选一张要还贡的牌', false); return; }
  const r = completeReturn(S.m, card);
  if (!r.ok) { showToast('还贡不合法：选一张 ≤10 的牌（没有则选最小的一张）', false); return; }
  S.sel = []; save(); scheduleAi();
}
function doPlay() {
  if (!myTurn.value) return;
  if (!selCards.value.length) { showToast('请先点选要出的牌', false); return; }
  const r = play(S.m, HUMAN, selCards.value);
  if (!r.ok) {
    const msg = { 'not-a-combo': '选中的不是合法牌型', 'too-small': '压不过当前牌', empty: '未选牌' }[r.reason] || r.reason;
    showToast(msg, false); return;
  }
  S.sel = []; save(); scheduleAi();
}
function doPass() {
  if (!myTurn.value) return;
  if (!S.m.leaderCombo) { showToast('领出不能过牌，请出牌', false); return; }
  const r = pass(S.m, HUMAN);
  if (!r.ok) { showToast('现在不能过牌', false); return; }
  S.sel = []; save(); scheduleAi();
}
function doHint() {
  if (!myTurn.value || !S.m) return;
  const h = hint(S.m, HUMAN, S.level);
  if (h.pass) { showToast('建议：过牌', true); return; }
  S.sel = h.cards.map(c => c.id);
  showToast('已圈出推荐出牌，点「出牌」打出', true);
}
function toggleAuto() {
  S.auto = !S.auto;
  S.sel = [];
  if (S.auto) showToast('自动开局已开启（含你方座位），再点停止', true);
  else if (S.m?.phase === 'handEnd') S.screen = 'handEnd'; // 关闭自动时若停在结算，露出「下一副」按钮
  scheduleAi();
}
function toggleFast() { S.fast = !S.fast; scheduleAi(); }
function autoContinue() { S.auto = true; S.fast = true; nextHand(); }

// ── AI 调度 ──
function scheduleAi() {
  clearTimeout(aiTimer);
  if (!S.m || S.m.phase !== 'play') return;
  const seat = S.m.turnSeat;
  if (seat === HUMAN && !S.auto) return;
  aiTimer = setTimeout(aiAct, S.fast ? 90 : 850);
}
function aiAct() {
  if (!S.m || S.m.phase !== 'play') return;
  const seat = S.m.turnSeat;
  const d = hint(S.m, seat, S.level);
  const r = d.pass ? pass(S.m, seat) : play(S.m, seat, d.cards);
  if (!r.ok) { showToast('AI 行动异常，已暂停（点任意操作可继续）', false); return; } // 边界：非法动作不无限重试
  save(); scheduleAi();
}

watch(() => S.m?.phase, p => {
  if (!S.m) return;
  if (p === 'handEnd') {
    if (S.auto) {
      // 修复（自动开局/自动继续整场）：曾在每副结算后停住等点「下一副」，无法"一人看完全场"。
      // 自动模式下短暂停留后自动开下一副；遇还贡（tribute）仍会暂停等手动处理。
      clearTimeout(aiTimer);
      aiTimer = setTimeout(() => nextHand(), S.fast ? 250 : 800);
    } else {
      S.screen = 'handEnd';
    }
  } else if (p === 'matchOver') {
    S.screen = 'over';
    S.auto = false; // 整场结束，复位自动
    try { localRemove(SAVE_KEY); } catch {}
  }
});

function nextHand() {
  // 边界：仅 handEnd 阶段可开下一副——防止「下一副」连点/自动定时器竞态导致中途重新发牌
  if (!S.m || S.m.matchOver || S.m.phase !== 'handEnd') return;
  startHand(S.m);
  S.sel = [];
  S.screen = 'table';
  sfx.deal(); // 新一副发牌音
  save(); scheduleAi();
}
function quitToMenu() {
  clearTimeout(aiTimer);
  S.auto = false;
  if (S.m && !S.m.matchOver) save();
  S.screen = 'menu';
}
/** v2.03 回岛：存档 + replace 回岛主页（不堆栈；返回语义=回本 SPA 主页） */
function leaveIsland() {
  clearTimeout(aiTimer);
  S.auto = false;
  if (S.m && !S.m.matchOver) save();
  router.replace('/island');
}

// ── 冒烟/自动对局钩子（浏览器回归用）──
function tickOnce() {
  // 同步走一步（当前座位 AI 决策并执行）；返回 'pass'|'play'|'handEnd'|'matchOver'|reason
  if (!S.m || S.m.phase !== 'play') return S.m ? S.m.phase : 'no-match';
  const seat = S.m.turnSeat;
  const d = hint(S.m, seat, S.level);
  if (d.pass) { pass(S.m, seat); return 'pass'; }
  const r = play(S.m, seat, d.cards);
  return r.ok ? 'play' : r.reason;
}
window.__guandan = {
  get m() { return S.m; },
  get level() { return S.level; },
  setLevel(n) { S.level = [0, 1, 2, 3, 4].includes(n) ? n : 2; scheduleAi(); },
  newMatch, continueMatch, nextHand, quitToMenu,
  setAuto(b) { S.auto = !!b; S.sel = []; if (!S.auto && S.m?.phase === 'handEnd') S.screen = 'handEnd'; scheduleAi(); },
  setFast(b) { S.fast = !!b; scheduleAi(); },
  select(ids) { S.sel = (ids || []).map(x => (typeof x === 'number' ? x : x.id)); },
  playHuman: () => doPlay(),
  passHuman: () => doPass(),
  hintHuman: () => doHint(),
  returnHuman: () => doReturn(),
  // 当前人类回合的推荐出牌详情（回归验证"提示会推荐炸弹"用）
  hintInfo() {
    if (!S.m || S.m.phase !== 'play' || S.m.turnSeat !== HUMAN) return null;
    const h = hint(S.m, HUMAN);
    if (h.pass) return { pass: true, leader: S.m.leaderCombo?.type ?? 'lead' };
    const c = recognize(h.cards, S.m.handLevel);
    return { cards: h.cards.map(x => ({ s: x.s, v: x.v, id: x.id })), type: c?.type, main: c?.main, power: c?.power, leader: S.m.leaderCombo?.type ?? 'lead' };
  },
  tick: tickOnce,
  // 同步打完整场（验证"一个人可以打完全部牌局"；不依赖定时器）
  // autoReturn=true 时自动替人类完成还贡（仅回归用）；默认 false → 遇还贡暂停并返回 needsReturn
  finishAll(opts = {}) {
    const maxSteps = opts.maxSteps ?? 500000;
    const autoReturn = !!opts.autoReturn;
    if (!S.m) return { ok: false, reason: 'no-match' };
    if (S.m.phase === 'handEnd') startHand(S.m);
    let steps = 0;
    while (S.m && !S.m.matchOver && steps++ < maxSteps) {
      if (S.m.phase === 'handEnd') startHand(S.m);
      if (S.m.phase === 'tribute') {
        if (!autoReturn) return { ok: false, needsReturn: true, handNo: S.m.handNo, steps };
        const card = S.m.hands[S.m.humanSeat].find(c => validReturn(S.m, c));
        if (!card) return { ok: false, reason: 'no-legal-return', handNo: S.m.handNo };
        completeReturn(S.m, card);
        continue;
      }
      if (S.m.phase !== 'play') break;
      const r = tickOnce();
      if (r !== 'pass' && r !== 'play') return { ok: false, reason: r, steps, handNo: S.m.handNo, seat: S.m.turnSeat };
    }
    return { ok: S.m?.matchOver, hands: S.m?.totalHands, winner: S.m?.winnerTeam, steps };
  }
};

onMounted(() => { if (canContinue()) S.screen = 'menu'; });
onBeforeUnmount(() => { clearTimeout(aiTimer); clearTimeout(toastTimer); });
</script>

<template>
  <div class="gtable">
  <!-- 牌桌 -->
  <div class="table-wrap" v-if="screen === 'table' && m">
    <div class="topbar">
      <span class="title">掼蛋 · 第 {{ m.handNo }} 副</span>
      <span class="chip level">级牌 <b>{{ lvlLabel(m.handLevel) }}</b> · 逢人配=红桃{{ lvlLabel(m.handLevel) }}</span>
      <span class="chip">打级方 <b>{{ teamName(m.leaderTeam) }}</b></span>
      <span class="chip">AI <b>{{ levelCn(S.level) }}</b></span>
      <span class="chip">自家
        <span class="lvl-track"><i v-for="d in teamProgress(0)" :key="d.v" class="dot" :class="{ on: d.on }">{{ lvlLabel(d.v) }}</i></span>
      </span>
      <span class="chip">对家
        <span class="lvl-track"><i v-for="d in teamProgress(1)" :key="d.v" class="dot" :class="{ on: d.on }">{{ lvlLabel(d.v) }}</i></span>
      </span>
      <span style="flex:1"></span>
      <span class="chip offline">单机 · 不计积分</span>
      <button class="btn ghost tiny" @click="toggleFast">{{ fast ? '慢速' : '快速' }}</button>
      <button class="btn ghost tiny" @click="quitToMenu">菜单</button>
      <button class="btn ghost tiny" @click="leaveIsland">回岛</button>
    </div>

    <div class="arena">
      <div class="top-row">
        <SeatBlock :m="m" :seat="2" :active="m.turnSeat === 2 && m.phase === 'play'" :trick="trickActions" :names="names" />
      </div>
      <div class="mid-row">
        <SeatBlock :m="m" :seat="1" :active="m.turnSeat === 1 && m.phase === 'play'" :trick="trickActions" :names="names" />
        <div class="center">
          <div class="trick-grid" :class="{ 'fx-boom': lastLogIsBomb }">
            <div v-for="s in [2, 3, 1, 0]" :key="s" class="trick-cell" :class="{ leader: leaderSeat === s }">
              <div class="cell-name">{{ names[s] }}<span v-if="!m.finishedOrder.includes(s) && m.hands[s].length <= 7" class="report-badge">报 {{ m.hands[s].length }}</span></div>
              <div class="trick-cards" v-if="cellAction(s)?.kind === 'play'">
                <span v-for="c in cellAction(s).cards" :key="(S.m?.log?.length || 0) + '-' + c.id" class="tcard" :class="{ red: c.s === 'H' || c.s === 'D', fresh: lastPlaySeat === s }">
                  <b class="rk">{{ rankText(c) }}</b><i class="st">{{ suitText(c) }}</i>
                </span>
                <span class="trick-count">×{{ cellAction(s).cards.length }}</span>
              </div>
              <div class="cell-note" v-else-if="cellAction(s)?.kind === 'pass'">过</div>
              <div class="cell-note wait" v-else>…</div>
            </div>
          </div>
          <div class="lead-banner" v-if="currentLeader">压着 <b>{{ names[currentLeader.seat] }}</b> · {{ typeCn(currentLeader.cards, m.handLevel) || '牌' }}</div>
          <div class="lead-banner free" v-else>自由领出</div>
        </div>
        <SeatBlock :m="m" :seat="3" :active="m.turnSeat === 3 && m.phase === 'play'" :trick="trickActions" :names="names" />
      </div>
    </div>

    <div class="handzone">
      <div class="playlog" v-if="playlog.length">
        <span v-for="(r, i) in playlog" :key="i" class="logchip" :class="{ me: r.seat === 0 }">
          <b>{{ names[r.seat] }}</b> {{ r.txt }}
        </span>
      </div>
      <div class="sel-summary">
        <template v-if="selCards.length">已选 <b>{{ selCards.length }}</b> 张 → {{ typeCn(selCards, m.handLevel) || '牌型未识别' }}</template>
        <template v-else>点选要出的牌 · 级牌 <b>{{ lvlLabel(m.handLevel) }}</b> 仅次于大小王</template>
      </div>
      <div class="hand">
        <CardView v-for="c in myCards" :key="m.handNo + '-' + c.id" :card="c" :selected="sel.includes(c.id)" :wild="isWild(c, m.handLevel)" @click="toggleSelect(c)" />
      </div>
      <div class="controls">
        <button class="btn ghost" :disabled="!myTurn || !m.leaderCombo" @click="doPass">过</button>
        <button class="btn ghost" :disabled="!myTurn" @click="doHint">提示</button>
        <button class="btn primary" :disabled="!myTurn || !selCards.length" @click="doPlay">出牌</button>
        <button class="btn" :class="{ danger: auto }" @click="toggleAuto">{{ auto ? '停止自动' : '自动开局' }}</button>
      </div>
      <div class="turn-hint" :class="{ you: myTurn }">
        {{ myTurn ? (m.leaderCombo ? '轮到你跟牌：更大的同型牌 / 炸弹 / 同花顺，或过' : '轮到你领出：出任意合法牌型') : '等待其他玩家出牌…' }}
      </div>
    </div>

    <!-- 还贡交互（你是收贡方时，手动选一张还出去）-->
    <div class="overlay" v-if="inTribute">
      <div class="panel">
        <h2>进贡 · 还贡</h2>
        <h3>上副你方胜 · 你收到 {{ names[tributeAct?.giver ?? tributeTarget] }} 的贡牌</h3>
        <div class="tribute-line" v-if="tributeAct?.tribute">
          收到贡牌：
          <CardView :card="tributeAct.tribute" :mini="true" :wild="isWild(tributeAct.tribute, m.handLevel)" style="display:inline-block;vertical-align:middle" />
          <span style="margin-left:8px;color:var(--txt-dim);font-size:12px">请选一张 ≤10 的牌还给 {{ names[tributeTarget] }}（没有 ≤10 则选最小；标灰的不可还）</span>
        </div>
        <div class="hand" style="max-height:230px;overflow:auto">
          <CardView v-for="c in myCards" :key="c.id" :card="c"
            :selected="sel.includes(c.id)" :wild="isWild(c, m.handLevel)"
            :class="{ dim: !isReturnLegal(c) }" @click="toggleSelect(c)" />
        </div>
        <div class="actions">
          <button class="btn primary" style="width:100%" :disabled="!sel.length || !isReturnLegal(m.hands[0].find(c=>sel.includes(c.id)))" @click="doReturn">确认还贡</button>
        </div>
      </div>
    </div>

    <div v-if="m.tributeInfo && m.handNo > 1 && !inTribute" class="toast ok" style="top:auto;bottom:120px;left:12px;transform:none">
      {{ m.tributeInfo.resisted ? '本副抗贡（两大王在手）· 头游先出' : '已进贡/还贡 · 头游先出' }}
    </div>
    <div v-if="toast" class="toast" :class="{ ok: toast.ok }">{{ toast.msg }}</div>
  </div>

  <!-- 菜单 -->
  <div class="overlay" v-else-if="screen === 'menu'">
    <div class="panel menu">
      <h1>掼蛋</h1>
      <div class="slogan">单机 · 一人对战 3 个 AI · 从 2 一路打到 A</div>
      <ul>
        <li>两副牌 108 张、每人 27 张、无底牌；逆时针出牌，自家（你＋上方搭档）vs 对家（左右两家 AI）。</li>
        <li>升级：双下 +3 / 1-3游 +2 / 1-4游 +1；打 A 局头游且对家非末游即过 A 获胜。</li>
        <li>逢人配＝红桃级牌，可顶替任意非王牌；级牌仅次于大小王。</li>
        <li>官方同型互压：只有牌型相同且张数相同才比大小（组合牌比最大一张）；炸弹阶梯 4炸&lt;5炸&lt;同花顺&lt;6~8炸&lt;四王，炸弹压一切。</li>
        <li>第 2 副起进贡还贡（末游→头游、三游→二游；两大王合持抗贡；还贡≤10）；最后一手全过 → 对家接风。</li>
      <li>嫌手动麻烦？点「自动开局」一人看完全场。</li>
      <li>AI 难度五档（v1.49）：普通→进阶→高阶(默认)→地域→绝望；越往后可读局势、喂搭档、算烧牌越狠。</li>
    </ul>
    <div class="lv-row">
      <span class="dim">AI 难度</span>
      <button v-for="l in LEVELS" :key="l.id" class="btn tiny" :class="{ on: S.level === l.id }" @click="S.level = l.id">{{ l.cn }}</button>
    </div>
      <div class="actions">
        <button class="btn primary" @click="newMatch()">新开一局</button>
        <button class="btn" v-if="canContinue()" @click="continueMatch">继续上局</button>
        <button class="btn ghost" @click="leaveIsland">回岛 · 稍后再战</button>
      </div>
    </div>
  </div>

  <!-- 副牌结算 -->
  <div class="overlay" v-else-if="screen === 'handEnd' && m">
    <div class="panel fx-pop">
      <h2>第 {{ m.handNo }} 副结束</h2>
      <h3>胜方 {{ teamName(lastWinner) }} · 升 {{ m.lastAdv }} 级（下一副级牌 {{ lvlLabel(Math.min(14, m.teamLevels[lastWinner])) }}）</h3>
      <div class="row-list">
        <div class="rank-line" v-for="(s, i) in m.lastFinish" :key="i">
          <span class="medal">{{ ['🥇', '🥈', '🥉', '⚪'][i] }}</span>
          <span class="who">{{ names[s] }}</span>
          <span>{{ ['头游', '二游', '三游', '末游'][i] }}</span>
        </div>
      </div>
      <div class="row-list">
        <div class="rank-line">自家 级数<span class="lvl" style="margin-left:auto;color:var(--gold);font-weight:800">{{ lvlLabel(m.teamLevels[0]) }}</span></div>
        <div class="rank-line">对家 级数<span class="lvl" style="margin-left:auto;color:var(--gold);font-weight:800">{{ lvlLabel(m.teamLevels[1]) }}</span></div>
      </div>
      <div class="actions">
        <button class="btn primary" style="flex:1" @click="nextHand">下一副</button>
        <button class="btn" style="flex:1" @click="autoContinue">自动继续整场</button>
      </div>
    </div>
  </div>

  <!-- 整场结束 -->
  <div class="overlay" v-else-if="screen === 'over' && m">
    <div class="panel fx-pop">
      <h2>整场结束</h2>
      <div class="winline">
        <div class="big">{{ teamName(m.winnerTeam) }} 过 A 获胜 🎉</div>
        <div style="margin-top:6px;color:var(--txt-dim)">共 {{ m.totalHands }} 副牌</div>
      </div>
      <div class="row-list">
        <div class="rank-line">自家 胜副数<span style="margin-left:auto;font-weight:800">{{ m.teamWins[0] }}</span></div>
        <div class="rank-line">对家 胜副数<span style="margin-left:auto;font-weight:800">{{ m.teamWins[1] }}</span></div>
      </div>
      <div class="actions">
        <button class="btn primary" @click="newMatch()">再来一整场</button>
        <button class="btn ghost" @click="quitToMenu">返回菜单</button>
      </div>
    </div>
  </div>
  </div>
</template>

<style>
.gtable, .gtable * { box-sizing: border-box; }
/* style.css 的 .pcard 是像素面板（margin:10px/padding:12px/黑描边），与牌类 CardView 的 .pcard 类名冲突——
   在 .gtable 作用域整体归零，手牌/牌池/还贡的全部牌面不再吃进面板间距与描边 */
.gtable .pcard { margin: 0; padding: 0; }
/* 掼蛋 · 现代牌桌风格（非像素）：深绿呢绒 + 白色圆角卡牌 + 金色级牌高亮 */
.gtable {
  --felt-hi: #3e8e6a;
  --felt-lo: #1f5c43;
  --ink: #0b2b20;
  --card: #fdfdfb;
  --card-edge: #d9d9cf;
  --red: #d64550;
  --black: #22303a;
  --gold: #f2b21b;
  --panel: rgba(9, 38, 29, 0.55);
  --panel-solid: #10352a;
  --txt: #f1faee;
  --txt-dim: #c3dccd;
  --radius: 10px;
  /* 牌面尺寸随屏宽自适应（46~78px），字号同比缩放 */
  --card-w: clamp(46px, 4.6vw, 78px);
  --card-ratio: 1.43;
}
.gtable #app { height: 100%; }

/* ── 牌桌容器 ── */
.gtable .table-wrap {
  min-height: 100vh;
  display: flex; flex-direction: column;
  background:
    radial-gradient(120% 90% at 50% 20%, var(--felt-hi) 0%, var(--felt-lo) 60%, #143c2f 100%);
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  gap: 8px;
}

/* ── 顶栏 ── */
.gtable .topbar {
  position: sticky; top: 0; z-index: 10; /* 长页滚动时菜单/快速按钮随时可达 */
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: var(--panel); backdrop-filter: blur(4px);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: var(--radius); padding: 8px 12px;
}
.gtable .topbar .title { font-weight: 800; letter-spacing: .5px; font-size: 15px; }
.gtable .chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1);
  border-radius: 999px; padding: 3px 10px; font-size: 12.5px; color: var(--txt-dim);
}
.gtable .chip b { color: var(--txt); font-weight: 700; }
.gtable .chip.level { border-color: rgba(242,178,27,.5); background: rgba(242,178,27,.12); color: #ffe8b3; }
.gtable .chip.level b { color: var(--gold); }
.gtable .chip.offline { border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.05); color: var(--txt-dim); font-size: 11px; padding: 2px 8px; }

/* 级数进度条 */
.gtable .lvl-track { display: flex; gap: 2px; align-items: center; }
.gtable .lvl-track .dot {
  width: 15px; height: 15px; border-radius: 4px; font-size: 9.5px; line-height: 15px;
  text-align: center; background: rgba(255,255,255,.08); color: var(--txt-dim); font-weight: 700;
}
.gtable .lvl-track .dot.on { background: var(--gold); color: #3a2c00; }

/* ── 中盘（牌桌主体）：上=对家，中=左对手/中央/右对手，下=你的手牌 ── */
.gtable .arena {
  position: relative; flex: 1; min-height: 300px;
  display: flex; flex-direction: column; gap: 10px;
}
.gtable .arena .top-row { display: flex; justify-content: center; }
.gtable .arena .mid-row {
  flex: 1; min-height: 200px;
  display: grid; grid-template-columns: 170px 1fr 170px; gap: 10px; align-items: center;
}
.gtable .arena .mid-row .center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 0; width: 100%; }

/* 座位 */
.gtable .seat {
  display: flex; align-items: center; gap: 8px;
  background: var(--panel); border: 1px solid rgba(255,255,255,.08);
  border-radius: 12px; padding: 6px 10px; min-width: 130px;
  transition: box-shadow .25s, border-color .25s;
}
.gtable .seat.active { border-color: var(--gold); box-shadow: 0 0 0 2px rgba(242,178,27,.35), 0 4px 18px rgba(0,0,0,.35); }
.gtable .seat .avatar {
  width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  font-weight: 800; font-size: 14px; color: #fff; flex: 0 0 auto;
  background: linear-gradient(135deg, #457b9d, #1d3557);
}
.gtable .seat .meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.gtable .seat .name { font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; }
.gtable .seat .sub { font-size: 11px; color: var(--txt-dim); }
.gtable .seat .cnt {
  margin-left: auto; font-size: 18px; font-weight: 800; color: var(--txt);
  min-width: 26px; text-align: center;
}
.gtable .seat .cnt em { font-style: normal; font-size: 10px; color: var(--txt-dim); display: block; line-height: 1; }
.gtable .seat .tag { font-size: 10px; color: var(--gold); font-weight: 700; }
.gtable .seat.done .cnt { color: #8ff0a4; }

/* 牌背堆 */
.gtable .cardbacks { display: flex; }
.gtable .cardbacks .bk {
  width: 26px; height: 37px; margin-left: -18px; border-radius: 4px;
  background: linear-gradient(145deg, #3a6ea5, #1d3557);
  border: 1.5px solid rgba(255,255,255,.25); box-shadow: 0 2px 4px rgba(0,0,0,.3);
}
.gtable .cardbacks .bk:first-child { margin-left: 0; }

/* 中央出牌展示：2×2 各家"面前"出牌位（对家上/自家下/左右侧家）——小牌横向堆叠，固定高度不撑页 */
.gtable .trick-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
  width: 100%; max-width: 560px; margin: 0 auto;
  background: var(--panel); border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px; padding: 10px;
}
.gtable .trick-cell {
  /* 高度自然增长（去掉固定 height：曾预算不足把牌面裁成白杠）；grid 同行自动等高 */
  display: flex; flex-direction: column; gap: 4px;
  min-width: 0; overflow: hidden; position: relative;
  background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06);
  border-radius: 10px; padding: 5px 8px; transition: border-color .2s, box-shadow .2s;
}
.gtable .trick-cell.leader {
  border-color: var(--gold); box-shadow: 0 0 0 2px rgba(242,178,27,.28);
  background: rgba(242,178,27,.08);
}
.gtable .trick-cell .cell-name { font-size: 11px; color: var(--txt-dim); font-weight: 700; }
.gtable .report-badge { margin-left: 6px; padding: 1px 6px; border-radius: 8px; background: rgba(242,178,27,.18); border: 1px solid rgba(242,178,27,.55); color: #f2b21b; font-size: 10px; font-weight: 700; }
.gtable .trick-cell.leader .cell-name { color: var(--gold); }
.gtable .trick-cell .trick-cards { display: flex; flex-wrap: nowrap; align-items: flex-start; min-width: 0; overflow: visible; }
/* 牌池小牌 .tcard：独立类，不与 .pcard 全局体系纠缠；max() 下限保证小屏可读；负 margin 重叠让左上角点数/花色始终可见 */
.gtable .tcard {
  position: relative; width: max(calc(var(--card-w) * .62), 20px);
  height: calc(max(calc(var(--card-w) * .62), 20px) * var(--card-ratio));
  background: var(--card); border: 1px solid var(--card-edge); border-radius: 3px;
  box-shadow: 0 1px 2px rgba(0,0,0,.3); flex: 0 0 auto; color: var(--black);
}
.gtable .tcard + .tcard { margin-left: calc(var(--card-w) * -.34); }
.gtable .tcard .rk { position: absolute; top: 1px; left: 2px; font-size: max(calc(var(--card-w) * .24), 7px); font-weight: 800; line-height: 1.05; letter-spacing: -.5px; }
.gtable .tcard .st { position: absolute; top: calc(max(calc(var(--card-w) * .24), 7px) * 1.15 + 2px); left: 2px; font-size: max(calc(var(--card-w) * .2), 6px); font-style: normal; line-height: 1; }
.gtable .tcard.red { color: var(--red); }
/* v1.15 即时反馈：本圈新出的小牌飞入（backwards 填充，结束不锁死 transform，选牌抬升不受影响） */
.gtable .tcard.fresh { animation: cardInK .18s steps(2) backwards; }
.gtable .trick-cell .cell-note { font-size: 16px; font-weight: 800; color: var(--txt-dim); align-self: center; margin-top: 6px; }
.gtable .trick-cell .cell-note.wait { color: rgba(195,220,205,.4); font-size: 20px; }
.gtable .trick-count { position: absolute; right: 7px; top: 5px; font-size: 11px; font-weight: 800; color: var(--gold); text-shadow: 0 1px 2px rgba(0,0,0,.5); }
.gtable .lead-banner {
  font-size: 13px; color: var(--txt-dim); background: var(--panel);
  border: 1px solid rgba(255,255,255,.08); border-radius: 999px; padding: 5px 14px;
}
.gtable .lead-banner b { color: var(--gold); }
.gtable .lead-banner.free { color: var(--txt); }

/* ── 牌面（尺寸随屏宽自适应，字号同比缩放）── */
.gtable .pcard {
  position: relative; width: var(--card-w); height: calc(var(--card-w) * var(--card-ratio)); flex: 0 0 auto;
  background: var(--card); border: 1.5px solid var(--card-edge);
  border-radius: calc(var(--card-w) * .13); box-shadow: 0 2px 5px rgba(0,0,0,.25);
  user-select: none;
}
.gtable .pcard .tl { position: absolute; top: calc(var(--card-w) * .08); left: calc(var(--card-w) * .09); display: flex; flex-direction: column; align-items: center; line-height: .95; }
.gtable .pcard .br { position: absolute; bottom: calc(var(--card-w) * .08); right: calc(var(--card-w) * .09); transform: rotate(180deg); display: flex; flex-direction: column; align-items: center; line-height: .95; }
.gtable .pcard .rk { font-size: calc(var(--card-w) * .30); font-weight: 800; }
.gtable .pcard .st { font-size: calc(var(--card-w) * .26); }
.gtable .pcard .big { position: absolute; inset: 0; display: grid; place-items: center; font-size: calc(var(--card-w) * .52); opacity: .9; }
.gtable .pcard.red .rk, .gtable .pcard.red .st, .gtable .pcard.red .big { color: var(--red); }
.gtable .pcard.black .rk, .gtable .pcard.black .st, .gtable .pcard.black .big { color: var(--black); }
.gtable .pcard.joker .rk { font-size: calc(var(--card-w) * .22); }
.gtable .pcard .wild-badge {
  position: absolute; top: calc(var(--card-w) * -.14); right: calc(var(--card-w) * -.14); background: var(--gold); color: #3a2c00;
  font-size: calc(var(--card-w) * .17); font-weight: 800; border-radius: 999px; padding: 1px calc(var(--card-w) * .09); box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
.gtable .pcard.mini { width: calc(var(--card-w) * .6); height: calc(var(--card-w) * .6 * var(--card-ratio)); border-radius: calc(var(--card-w) * .08); }
.gtable .pcard.mini .rk { font-size: calc(var(--card-w) * .19); }
.gtable .pcard.mini .st { font-size: calc(var(--card-w) * .16); }
.gtable .pcard.mini .big { font-size: calc(var(--card-w) * .3); }
.gtable .pcard.mini .wild-badge { top: calc(var(--card-w) * -.1); right: calc(var(--card-w) * -.1); font-size: calc(var(--card-w) * .13); padding: 0 calc(var(--card-w) * .06); }
.gtable .pcard.dim { opacity: .4; filter: grayscale(.65); }

/* ── 你的手牌 ── */
.gtable .handzone {
  background: var(--panel); border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px; padding: 10px 12px;
}
.gtable .hand {
  /* 单行自适应重叠持牌：margin = clamp((容器宽-27×牌宽)/26, -牌宽, 0)——屏窄自动重叠、屏宽自动摊开 */
  /* width:100% 显式定宽：防止 clamp 内 100% 在 flex intrinsic sizing 阶段被解析成内容宽（曾致步进 20.7 而非 10.8） */
  display: flex; flex-wrap: nowrap; width: 100%; min-height: calc(var(--card-w) * 1.55); align-items: flex-end; justify-content: center;
}
.gtable .hand .pcard + .pcard { margin-left: clamp(calc((100% - 27 * var(--card-w)) / 26), calc(-1 * var(--card-w)), 0px); }
.gtable .hand .pcard { cursor: pointer; transition: transform .15s, box-shadow .15s; }
.gtable .hand .pcard.sel { transform: translateY(-12px); box-shadow: 0 0 0 2px var(--gold), 0 8px 16px rgba(0,0,0,.4); z-index: 1; }
.gtable .hand .pcard.dim { opacity: .92; }

/* 控制按钮 */
.gtable .controls { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 10px; }
.gtable .btn {
  font-size: 14px; font-weight: 900; border: 2px solid var(--ink); border-radius: 0; cursor: pointer;
  padding: 9px 18px; color: #fff; background: #457b9d;
  box-shadow: 0 3px 0 var(--ink); transition: transform .05s steps(2), box-shadow .05s steps(2);
}
.gtable .btn:active { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }
.gtable .btn:hover { filter: brightness(1.1); }
.gtable .btn:active { transform: translateY(1px); }
.gtable .btn:disabled { opacity: .45; cursor: not-allowed; }
.gtable .btn.primary { background: linear-gradient(135deg, #f2b21b, #e0912f); color: #3a2c00; }
.gtable .btn.danger { background: #b5485d; }
.gtable .btn.ghost { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15); }
.gtable .btn.tiny { padding: 6px 12px; font-size: 12.5px; }

.gtable .turn-hint { font-size: 12.5px; color: var(--txt-dim); text-align: center; margin-top: 6px; min-height: 18px; }
.gtable .turn-hint.you { color: var(--gold); font-weight: 700; }

/* ── 浮层面板（弹层可滚动：面板高于屏幕时按钮不会被截死，手机横屏关键）── */
.gtable .overlay {
  position: fixed; inset: 0; background: rgba(4, 20, 15, .72); backdrop-filter: blur(3px);
  display: grid; place-items: center; padding: 16px; z-index: 20;
  overflow-y: auto; -webkit-overflow-scrolling: touch;
}
.gtable .panel {
  background: var(--panel-solid); border: 3px solid var(--ink);
  border-radius: 0; padding: 22px 26px; width: min(460px, 94vw);
  box-shadow: 0 5px 0 var(--ink);
  display: flex; flex-direction: column; gap: 14px;
  margin: auto; /* 内容超出时退化为顶部对齐 + overlay 滚动，避免 grid 居中裁掉顶部 */
  max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px);
  overflow-y: auto; -webkit-overflow-scrolling: touch;
}
.gtable .panel h2 { margin: 0; font-size: 20px; text-align: center; }
.gtable .panel h3 { margin: 4px 0 0; font-size: 13px; color: var(--txt-dim); text-align: center; font-weight: 500; }
.gtable .row-list { display: flex; flex-direction: column; gap: 6px; }
.gtable .rank-line {
  display: flex; align-items: center; gap: 8px; font-size: 14px;
  background: rgba(255,255,255,.05); border-radius: 8px; padding: 7px 10px;
}
.gtable .rank-line .medal { font-size: 15px; }
.gtable .rank-line .who { font-weight: 700; min-width: 52px; }
.gtable .rank-line .lvl { margin-left: auto; color: var(--txt-dim); font-size: 12px; }
.gtable .tribute-line { font-size: 13px; color: var(--txt-dim); background: rgba(242,178,27,.08); border-radius: 8px; padding: 8px 10px; }
.gtable .tribute-line.resist { background: rgba(214,69,80,.14); color: #ffb3ba; }

.gtable .menu { text-align: left; }
.gtable .menu h1 { margin: 0 0 4px; font-size: 26px; }
.gtable .menu .slogan { color: var(--txt-dim); font-size: 13.5px; margin-bottom: 14px; }
.gtable .menu ul { margin: 0 0 16px; padding-left: 18px; color: var(--txt-dim); font-size: 13px; line-height: 1.7; }
/* v1.49 难度五级行（对齐牛牛/德州/麻将 lv-row 模式） */
.gtable .lv-row { display: flex; align-items: center; gap: 6px; margin: 0 0 14px; flex-wrap: wrap; }
.gtable .lv-row .dim { font-size: 12px; color: var(--txt-dim); }
.gtable .lv-row .btn.tiny { padding: 3px 10px; font-size: 12px; }
.gtable .lv-row .btn.on { background: #f2b21b; color: #3a2c00; }
.gtable .menu .actions { display: flex; flex-direction: column; gap: 9px; }
.gtable .menu .actions .btn { width: 100%; }

.gtable .winline { text-align: center; font-size: 15px; }
.gtable .winline .big { font-size: 22px; font-weight: 800; color: var(--gold); }

.gtable .toast {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
  background: rgba(10, 30, 24, .95); color: #ffb3ba; border: 1px solid rgba(214,69,80,.5);
  border-radius: 999px; padding: 8px 16px; font-size: 13px; font-weight: 600; z-index: 40;
  box-shadow: 0 6px 18px rgba(0,0,0,.4);
}
.gtable .toast.ok { color: #b9fbc0; border-color: rgba(143,240,164,.5); }

/* 提示浮标（当前选牌摘要） */
.gtable .playlog {
  display: flex; gap: 6px; overflow-x: auto; padding: 4px 2px 6px;
  scrollbar-width: thin; min-height: 26px;
}
.playlog .logchip {
  flex: 0 0 auto; font-size: 11.5px; color: var(--txt-dim);
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.09);
  border-radius: 999px; padding: 2px 9px; white-space: nowrap;
}
.playlog .logchip b { color: var(--txt); font-weight: 700; }
.playlog .logchip.me { border-color: rgba(242,178,27,.45); background: rgba(242,178,27,.1); }
.playlog .logchip.me b { color: var(--gold); }
.sel-summary { text-align: center; font-size: 12.5px; color: var(--txt-dim); min-height: 16px; margin-top: 6px; }
.gtable .sel-summary b { color: var(--gold); }

@media (max-width: 640px) {
.gtable .arena .mid-row { grid-template-columns: 1fr; gap: 8px; }
.gtable .arena .mid-row .center { order: -1; }
.gtable .seat { min-width: 0; }
}


/* ── 手机横屏（≤480px 高）：高度优先约束，整桌一屏放下，手牌单行 ── */
@media (orientation: landscape) and (max-height: 480px) {
  .gtable {
    --card-w: min(calc((var(--vh, 100vh) - 178px) / 1.43), calc((100vw - 148px) / 24), 44px);
  }
  .gtable .table-wrap { min-height: 0; height: var(--vh, 100vh); overflow-y: auto; gap: 4px; padding: 6px 8px calc(4px + env(safe-area-inset-bottom)); }
  /* 弹层（菜单/副牌结算/还贡/整场结束）：横屏必可滚，按钮不允许被截在屏外 */
  .gtable .overlay { padding: 8px; }
  .gtable .panel { padding: 12px 16px; gap: 8px; max-height: calc(var(--vh, 100vh) - 12px); }
  .gtable .panel h2 { font-size: 17px; }
  .gtable .panel h3 { font-size: 12px; }
  .gtable .menu h1 { font-size: 20px; margin-bottom: 2px; }
  .gtable .menu .slogan { font-size: 11.5px; margin-bottom: 6px; }
  .gtable .menu ul { font-size: 11.5px; line-height: 1.55; margin-bottom: 8px; }
  .gtable .overlay .hand { max-height: 140px; }
  .gtable .topbar { gap: 6px; padding: 4px 8px; }
  .gtable .topbar .title { font-size: 14px; }
  .gtable .topbar .chip { font-size: 11px; padding: 2px 8px; }
  .gtable .lvl-track { display: none; }
  .gtable .topbar .btn.tiny { padding: 3px 8px; font-size: 11px; }
  .gtable .arena { flex: 0 0 auto; min-height: 0; }
  .gtable .arena .top-row { padding: 0; }
  .gtable .arena .mid-row { min-height: 0; grid-template-columns: 150px 1fr 150px; }
  .gtable .seat { min-width: 0; }
  .gtable .arena .mid-row { gap: 6px; }
  .gtable .trick-grid { padding: 4px; gap: 4px; max-width: 460px; }
  .gtable .trick-cell { padding: 3px 6px; } /* 高度自然增长，横屏不再锁死（曾锁 18px 预算裁掉牌面） */
  .gtable .trick-cell .cell-name { font-size: 10px; }
  .gtable .lead-banner { padding: 2px 10px; font-size: 12px; }
  .gtable .seat { padding: 3px 5px; gap: 4px; }
  .gtable .seat .avatar { width: 26px; height: 26px; font-size: 11px; }
  .gtable .seat .name { font-size: 11px; }
  .gtable .seat .sub { display: none; }
  .gtable .seat .bk { width: 10px; height: 14px; }
  .gtable .seat .cnt { font-size: 11px; }
  .gtable .playlog { display: none; }
  .gtable .sel-summary { margin-top: 2px; min-height: 14px; font-size: 11px; }
  .gtable .hand { padding: 2px; } /* 单行重叠已在基础样式，横屏不再横向滑动 */
  .gtable .handzone { padding: 4px 10px; }
  .gtable .controls { margin-top: 3px; gap: 6px; }
  .gtable .controls .btn { padding: 5px 14px; font-size: 12px; min-width: 0; }
  .gtable .controls .btn.primary { min-width: 64px; }
  .gtable .turn-hint { margin-top: 2px; font-size: 11px; min-height: 13px; }
}
@media (orientation: landscape) and (max-height: 480px) and (max-width: 520px) {
  .gtable { --card-w: min(calc((var(--vh, 100vh) - 178px) / 1.43), calc((100vw - 140px) / 24), 34px); }
}
/* ── v1.53 手机竖屏：27 张单行重叠叠死（360px 屏每牌仅露 ~11px，难操作）→ 两行换牌（14+13）──
   牌宽随屏宽自适应（每行 14 张），行间 3px 间距、取消横向重叠 → 竖屏不再堆叠、可逐张点选 */
@media (orientation: portrait) {
  .gtable { --card-w: min(54px, calc((100vw - 110px) / 14)); }
  .gtable .hand { flex-wrap: wrap; gap: 3px; row-gap: 5px; justify-content: center; min-height: 0; }
  .gtable .hand .pcard + .pcard { margin-left: 0; }
  .gtable .handzone { padding: 8px 6px; }
}
</style>
