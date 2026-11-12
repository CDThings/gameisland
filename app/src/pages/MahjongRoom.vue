<script setup>
// 麻将·推倒胡（Space 集成版）：逻辑在 @space/shared/cards/mahjong，本页只做交互与展示
// 整场 = 4 局（每家轮一次庄）+ 累计分排名；开局有规则屏。
import { reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import {
  createSession, startSessionHand, endSessionHand,
  discard, doClaim, claimOptions, selfHu, aiDiscard, aiClaimDecision, gameover, TILE_CN,
  anGang, anGangOptions, jiaGang, jiaGangOptions, waits, turnHint, discardHint, claimHint,
  listenForAll, matchBoard, handLog, fanDetail, serialize, restore
} from '@space/shared/cards/mahjong';
import { formatChipDisplay } from '@space/shared/cards/meta';
import { sfx } from '../ui/sfx.js';
import { localGet, localSet, localRemove } from '../env.js';

const NAMES = { 0: '你', 1: '左家·AI', 2: '对家·AI', 3: '右家·AI' };
// v1.52 五级难度（与掼蛋同源命名；默认 1=进阶=历史零回归）
const LV_CN = ['普通', '进阶', '高阶', '地域', '绝望'];
const S = reactive({ phase: 'menu', sess: null, g: null, endFired: false, level: 1, fast: false, auto: false, hint: null });
let timer = 0;

// v1.41 单机存档（对齐掼蛋 localStorage「继续上局」）：开局/局终推进点落 localStorage，损坏→降级新开
const SAVE_KEY = 'mahjong.save.v1';
function save() { if (S.sess) try { localSet(SAVE_KEY, serialize(S.sess)); } catch { /* 存储满/隐私模式忽略 */ } }
// 仅菜单态计算并随 S.phase 重读
const saved = computed(() => {
  if (S.phase !== 'menu') return null;
  try { const j = localGet(SAVE_KEY); return j ? restore(j) : null; } catch { return null; }
});
function continueMatch() {
  try {
    S.sess = restore(localGet(SAVE_KEY));
    S.endFired = false; S.auto = false; S.hint = null; S.phase = 'play';
    const g = S.sess.game;
    if (g && !gameover(g)) { S.g = g; g.aiLevel = S.level; schedule(); } // 一局中途存档 → 续打该局（档位随所选难度）
    else startHand();                                 // 局终存档(game=null) → 开下一局
    save();
  } catch { newSession(); } // 存档损坏/跨版本 → 降级新开
}

function newSession() {
  clearTimeout(timer);
  S.sess = createSession((Date.now() ^ (Math.random() * 0xffffff)) & 0x7fffffff, 0, 4);
  S.phase = 'play';
  startHand();
}
function startHand() {
  S.endFired = false;
  S.g = startSessionHand(S.sess);
  if (S.g) S.g.aiLevel = S.level; // v1.51：写入档位 → AI 暗杠/加杠门控与打牌策略随所选难度
  sfx.deal(); // v1.15 发牌音
  schedule();
  save(); // v1.41 开局即存（一局中途可存）
}
function onHandEnd() {
  const sess = S.sess, g = S.g;
  if (!g || !gameover(g)) return;
  if (S.endFired) return;
  S.endFired = true;
  endSessionHand(sess);
  save(); // v1.41 局终存（game=null → 续打时开下一局）
  timer = setTimeout(() => {
    if (sess.over) { S.auto = false; S.phase = 'result'; return; }
    startHand();
  }, 1200);
}
function schedule() {
  clearTimeout(timer);
  const g = S.g;
  if (!g || S.phase !== 'play' || gameover(g)) { onHandEnd(); return; }
  if (g.phase === 'claim') {
    const cur = g.claimPending.cur;
    if (cur === 0 && !S.auto) return; // 人座声明：非自动时等玩家点（胡/杠/碰/过）
    timer = setTimeout(() => {
      if (!S.g || gameover(S.g) || S.g.phase !== 'claim' || S.g.claimPending.cur !== cur) return;
      doClaim(g, cur, aiClaimDecision(g, cur, S.level)); // v1.23 策略层（含人座自动）
      schedule();
    }, S.fast ? 120 : 650);
    return;
  }
  if (g.phase === 'discard' && (g.turn !== 0 || S.auto)) { // 非人座恒自动；人座仅 S.auto 时替打
    timer = setTimeout(() => {
      if (!S.g || gameover(S.g) || S.g.phase !== 'discard' || S.g.turn !== g.turn) return;
      const g2 = S.g;
      if (g2.selfHuPending) selfHu(g2, g2.turn); // 自动下：人座摸到胡 → 自摸
      else discard(g2, g2.turn, aiDiscard(g2, g2.turn, S.level));
      schedule();
    }, S.fast ? 120 : 650);
  }
}
onMounted(() => {});
onBeforeUnmount(() => clearTimeout(timer));

// v1.29 自动打完：切换 auto 后需重新 schedule（当前若停在人座等待，切 auto 即 AI 替打）
function toggleAuto() { S.auto = !S.auto; S.auto && (S.fast = true); schedule(); }
// v1.30 掼蛋「提示」移植：人座当前该做什么（声明相→胡/杠/碰/过建议；打牌相→打哪张+听几门）
function showHint() {
  const g = S.g;
  if (!g || g.humanSeat !== 0 || gameover(g)) return;
  S.hint = g.phase === 'claim' && g.claimPending?.cur === 0
    ? claimHint(g, 0, 2)
    : { text: discardHint(g, 0, 2).text };
}

const g = computed(() => S.g);
const sess = computed(() => S.sess);
const myClaims = computed(() => (g.value && g.value.phase === 'claim' && g.value.claimPending.cur === 0 ? claimOptions(g.value, 0) : null));
const canDiscard = computed(() => !!(g.value && g.value.phase === 'discard' && g.value.turn === 0 && !gameover(g.value)));
const myAnGangs = computed(() => (g.value && g.value.phase === 'discard' && g.value.turn === 0 && !gameover(g.value) ? anGangOptions(g.value, 0) : []));
// v1.24 听牌提示（对齐掼蛋"报牌"）：13 张稳定手牌下，列出摸到即胡的进牌（纯函数 waits）
const myTenpai = computed(() => {
  const gg = g.value;
  if (!gg || gg.humanSeat !== 0 || gameover(gg)) return [];
  if (gg.hands[0].length !== 13) return [];
  return waits(gg.hands[0]);
});
// v1.26 当前轮提示（掼蛋 turn-hint 移植）：共享纯函数 turnHint 驱动座位高亮 + 文案
const mh = computed(() => turnHint(S.g));
// v1.37 各家听口数（掼蛋"报牌"的麻将等价）：谁在听、听几张
const listen = computed(() => listenForAll(S.g));
// v1.39 整场态势（对齐牛牛记分牌 / 德州态势）：领先者/分差/整场进度（shared matchBoard 纯函数）
const mb = computed(() => matchBoard(S.sess));
// v1.39 本局关键事件流（对齐掼蛋出牌日志 / 德州下注日志）：碰/明杠/暗杠/自摸/点炮/流局 时间线
const hlog = computed(() => handLog(S.g));
function hLogText(e) {
  const tile = e.tile != null ? TILE_CN[e.tile] : '';
  if (e.k === '流局') return '流局';
  if (e.k === '自摸') return `${NAMES[e.s]} 自摸胡${tile ? '（' + tile + '）' : ''}`;
  if (e.k === '杠上花') return `${NAMES[e.s]} 杠上花（补 ${tile}）`;
  if (e.k === '点炮') return `${NAMES[e.by]} 点炮${tile} → ${NAMES[e.s]} 胡`;
  if (e.k === '碰') return `${NAMES[e.s]} 碰${tile}`;
  if (e.k === '明杠') return `${NAMES[e.s]} 明杠${tile}`;
  if (e.k === '暗杠') return `${NAMES[e.s]} 暗杠${tile}`;
  if (e.k === '加杠') return `${NAMES[e.s]} 加杠${tile}`;
  return e.k;
}
// v1.15 即时反馈：单局胡牌/流局音效 + 整场结束音效
watch(() => (g.value ? gameover(g.value) : false), (v) => {
  if (v && g.value) { g.value.winner != null ? sfx.fanfare() : sfx.miss(); }
});
watch(() => S.phase, (v) => { if (v === 'result' && S.sess) { S.sess.champ === 0 ? sfx.fanfare() : sfx.miss(); try { localRemove(SAVE_KEY); } catch { /* noop */ } } });
function clickTile(t) { if (!canDiscard.value) return; S.hint = null; discard(S.g, 0, t); sfx.tap(); schedule(); }
function claim(act) {
  if (!myClaims.value) return;
  S.hint = null;
  doClaim(S.g, 0, act);
  if (act === 'hu') sfx.fanfare(); else if (act === 'gang') sfx.ding(); else if (act === 'peng') sfx.tap();
  schedule();
}
function huNow() { if (S.g && S.g.selfHuPending && S.g.turn === 0) { selfHu(S.g, 0); sfx.fanfare(); schedule(); } }
function doAnGang(t) { const r = anGang(S.g, 0, t); if (r.ok) { sfx.ding(); schedule(); } }
// v1.52 副露标签统一（碰/明杠/暗杠/加杠），四处座位渲染共用
function meldLabel(md) {
  if (md.concealed) return '暗杠 ' + TILE_CN[md.tile];
  if (md.kind === 'jiagang') return '加杠 ' + TILE_CN[md.tile];
  if (md.kind === 'gang') return '明杠 ' + TILE_CN[md.tile];
  return '碰 ' + TILE_CN[md.tile];
}
// v1.52 声明相文案：claim 时"等待 X 声明"（原误显示"出牌"）
const claimWait = computed(() => {
  const gg = g.value;
  if (!gg || gg.phase !== 'claim' || !gg.claimPending) return null;
  return `等待 ${NAMES[gg.claimPending.cur]} 声明（胡/杠/碰）…`;
});
function doJiaGang(t) { const r = jiaGang(S.g, 0, t); if (r.ok) { sfx.ding(); schedule(); } }

// v1.52 胡牌展示：赢家 14 张 + 胡牌张 + 番明细（fanDetail 纯函数）
const winReveal = computed(() => {
  const gg = g.value;
  if (!gg || gameover(gg) === false || gg.winner == null || !gg.lastWin) return null;
  const w = gg.winner;
  const detail = fanDetail(gg, w, gg.lastWin.selfDrawn, gg.lastWin.viaGang);
  return {
    winner: w,
    tiles: gg.hands[w].slice(),
    winTile: gg.lastWin.tile,
    fanParts: detail.parts,
    fan: gg.lastWin.fan,
    pay: gg.lastWin.pay,
    selfDrawn: gg.lastWin.selfDrawn,
    viaGang: gg.lastWin.viaGang,
    from: gg.lastWin.from,
  };
});
const myJiaGangs = computed(() => (g.value && g.value.phase === 'discard' && g.value.turn === 0 && !gameover(g.value) ? jiaGangOptions(g.value, 0) : []));

const rankings = computed(() => {
  const se = S.sess; if (!se) return [];
  return [0, 1, 2, 3].sort((a, b) => se.total[b] - se.total[a] || se.wins[b] - se.wins[a]);
});
// 冒烟/整场驱动钩子（对齐 GuandanRoom.__guandan.finishAll 惯例）
window.__mahjong = {
  get sess() { return S.sess; },
  get g() { return S.g; },
  get level() { return S.level; },
  setLevel(n) { S.level = [0, 1, 2, 3, 4].includes(n) ? n : 1; if (S.g) S.g.aiLevel = S.level; schedule(); },
  newSession,
  // 同步打完整场：AI 全自动；人类座位(0)按"胡>杠>碰、听牌胡、否则 aiDiscard"
  finishSession() {
    const se = S.sess; if (!se) return { ok: false, reason: 'no-session' };
    let guard = 0;
    while (!se.over && guard++ < 300000) {
      const g = S.g || startSessionHand(se);
      S.g = g;
      while (!gameover(g)) {
        if (g.phase === 'claim') {
          const cur = g.claimPending.cur;
          const o = claimOptions(g, cur);
          doClaim(g, cur, aiClaimDecision(g, cur, S.level));
        } else if (g.phase === 'discard') {
          if (g.selfHuPending) { selfHu(g, g.turn); break; }
          const d = g.turn === 0 ? null : aiDiscard(g, g.turn, S.level);
          discard(g, g.turn, d ?? aiDiscard(g, g.turn, S.level));
        }
      }
      endSessionHand(se);
      S.g = null;
    }
    S.phase = se.over ? 'result' : 'play';
    return { ok: true, hands: se.games.length, over: se.over };
  },
};
</script>

<template>
  <div class="gtable mj">
    <div class="table-wrap">
      <div class="topbar">
        <span class="title">麻将 · 推倒胡</span>
        <template v-if="S.phase === 'play' && sess">
          <span class="chip">轮转 <b>{{ sess.handNo }}/4</b> · 庄 <b>{{ NAMES[sess.dealer] }}</b> · 已打 <b>{{ sess.games.length }}</b> 局</span>
          <span class="chip">你 <b>{{ sess.total[0] >= 0 ? '+' : '' }}{{ sess.total[0] }}</b></span>
          <span class="chip lead" v-if="mb && !sess.over && mb.spread > 0">领先 <b>{{ NAMES[mb.leader] }}</b> · 分差 {{ mb.spread }}</span>
          <span v-if="sess.chips && sess.chips.length" class="chip term">词条 {{ formatChipDisplay(sess.chips) }}</span>
          <span class="chip lvl">AI {{ LV_CN[S.level] }}</span>
        </template>
        <span style="flex:1"></span>
        <span class="chip offline">单机 · 不计积分</span>
        <button class="btn ghost tiny" v-if="S.phase === 'play'" @click="S.fast = !S.fast">{{ S.fast ? '慢速' : '快速' }}</button>
        <button class="btn ghost tiny" v-if="S.phase === 'play'" :class="{ on: S.auto }" @click="toggleAuto()">{{ S.auto ? '停止自动' : '自动打完' }}</button>
        <button class="btn ghost tiny" @click="$router.replace('/island')">返回大厅</button>
      </div>

      <!-- 开局规则屏 -->
      <div v-if="S.phase === 'menu'" class="menu-panel">
        <h3>麻将 · 推倒胡（单机 4 人桌）</h3>
        <div class="slogan">1 人 vs 3 AI · 4 庄整场（连庄制）· 番计分 · 累计分决冠军</div>
        <ul>
          <li>136 张（万筒条 1-9 ×4 + 字牌 ×4）；庄家 14 张先打；出牌顺序 你 → 左家 → 对家 → 右家。</li>
          <li>胡牌 = 4 组（顺/刻）+ 雀头，或七对，或十三幺；可碰 / 明杠 / 暗杠 / <b>加杠</b>（碰后再摸到第 4 张）；声明 胡 &gt; 杠 &gt; 碰。</li>
          <li><b>番</b>（封顶 8）：基础胡 1、门清 +1、自摸 +1、杠上花 +1、七对 +2（豪华再 +1）、十三幺 +6、碰碰胡 +2、清一色 +2、混一色 +1、全数色 +1。</li>
          <li><b>计分 = 底分×番</b>：自摸底 ×2（三家各付）；点炮仅点炮者付。</li>
          <li><b>连庄</b>：庄胡连坐；客胡/流局顺时针换庄（整场 4 轮转）。</li>
        </ul>
        <div class="lv-row">
          <span class="dim">AI 难度</span>
          <button v-for="(lab, l) in { 0: '普通', 1: '进阶', 2: '高阶', 3: '地域', 4: '绝望' }" :key="l" class="btn tiny" :class="{ on: S.level === l }" @click="S.level = l">{{ lab }}</button>
        </div>
        <button class="btn" v-if="saved && !saved.over" @click="continueMatch()">继续上局（已打 {{ saved.games.length }} 局）</button>
        <button class="btn primary" @click="newSession()">开整场（4 庄 · 连庄制）</button>
      </div>

      <template v-else>
        <!-- 真实牌桌方位：对家上、左/右两侧、自家下；每家带弃牌河 -->
        <div class="mj-arena" v-if="g">
          <div class="mj-seat mj-top" :class="{ act: mh.activeSeat === 2 }">
            <span class="mj-name">{{ NAMES[2] }}<em v-if="g.dealer === 2">庄</em><span v-if="g.hands[2].length <= 7" class="report-badge">余 {{ g.hands[2].length }}</span></span>
            <span class="mj-discard" v-if="g.discards[2].length">
              <b v-for="(t, i) in g.discards[2].slice(-8)" :key="i === g.discards[2].slice(-8).length - 1 ? 'L' + g.discards[2].length : i" class="mj-d" :class="{ last: i === g.discards[2].slice(-8).length - 1 }">{{ TILE_CN[t] }}</b>
            </span>
            <span class="mj-meld" v-for="(md, i) in g.melds[2]" :key="'m' + i" :class="{ last: i === g.melds[2].length - 1 }">{{ meldLabel(md) }}</span>
          </div>

          <div class="mj-mid">
            <div class="mj-seat mj-side" :class="{ act: mh.activeSeat === 1 }">
              <span class="mj-name">{{ NAMES[1] }}<em v-if="g.dealer === 1">庄</em><span v-if="g.hands[1].length <= 7" class="report-badge">余 {{ g.hands[1].length }}</span></span>
              <span class="mj-cnt">手 {{ g.hands[1].length }}</span>
              <span class="mj-discard" v-if="g.discards[1].length">
                <b v-for="(t, i) in g.discards[1].slice(-8)" :key="i === g.discards[1].slice(-8).length - 1 ? 'L' + g.discards[1].length : i" class="mj-d" :class="{ last: i === g.discards[1].slice(-8).length - 1 }">{{ TILE_CN[t] }}</b>
              </span>
              <span class="mj-meld" v-for="(md, i) in g.melds[1]" :key="'m' + i" :class="{ last: i === g.melds[1].length - 1 }">{{ meldLabel(md) }}</span>
            </div>

            <div class="mj-center">
              <div class="mj-prog" v-if="mb">
                <span class="mj-prog-track"><i :style="{ width: (mb.progress * 100) + '%' }"></i></span>
                <span class="mj-prog-label">整场 {{ mb.handNo }}/{{ mb.hands }} 局</span>
              </div>
              <div class="mj-wall">余墙 <b>{{ g.wall.length }}</b></div>
              <div class="mj-last" v-if="g.lastDiscard != null">最新弃 <b>{{ TILE_CN[g.lastDiscard] }}</b>（{{ NAMES[g.lastFrom] }}）</div>
              <div class="mj-hlog" v-if="hlog.length">
                <span v-for="(e, i) in hlog.slice(-6)" :key="i" class="mj-hlog-chip">{{ hLogText(e) }}</span>
              </div>
              <div class="mj-listen" v-if="!gameover(g) && listen.tenpai.length">听口 <b v-for="s in listen.tenpai" :key="s">{{ NAMES[s] }} {{ listen.counts[s] }}门</b></div>
              <div class="mj-actions" v-if="(myClaims || canDiscard) && !S.auto">
                <button class="btn ghost" @click="showHint()">提示</button>
                <span class="mj-hint" v-if="S.hint">{{ S.hint.text }}</span>
              </div>
              <div class="mj-actions" v-if="myClaims">
                <button class="btn primary" v-if="myClaims.hu" @click="claim('hu')">胡（点炮）</button>
                <button class="btn" v-if="myClaims.gang" @click="claim('gang')">杠</button>
                <button class="btn" v-if="myClaims.peng" @click="claim('peng')">碰</button>
                <button class="btn ghost" @click="claim('pass')">过</button>
              </div>
              <div class="mj-actions" v-if="g.selfHuPending && g.turn === 0">
                <button class="btn primary" @click="huNow()">自摸胡</button>
                <span class="hh-tag">（或打任意牌过）</span>
              </div>
              <div class="mj-actions" v-if="myAnGangs.length && !S.auto">
                <button v-for="t in myAnGangs" :key="t" class="btn" @click="doAnGang(t)">暗杠 {{ TILE_CN[t] }}</button>
              </div>
              <div class="mj-actions" v-if="myJiaGangs.length && !S.auto">
                <button v-for="t in myJiaGangs" :key="'j' + t" class="btn" @click="doJiaGang(t)">加杠 {{ TILE_CN[t] }}</button>
              </div>
              <div class="mj-status" v-if="gameover(g)">
                <b class="line-big">{{ g.winner != null ? `🏆 ${NAMES[g.winner]} ${g.lastWin?.viaGang ? '杠上花' : g.lastWin?.selfDrawn ? '自摸' : '点炮'}胡！` : '流局' }}</b>
                <!-- v1.52 胡牌展示：赢家 14 张 + 胡牌张 + 番明细（fanDetail） -->
                <div v-if="winReveal" class="mj-winline">
                  <span v-for="(t, i) in winReveal.tiles" :key="'w' + i" class="wj-tile" :class="{ win: t === winReveal.winTile }">{{ TILE_CN[t] }}</span>
                </div>
                <div v-if="winReveal" class="line-sub">胡 <b>{{ winReveal.winTile != null ? TILE_CN[winReveal.winTile] : '—' }}</b> · {{ winReveal.fan }} 番（{{ winReveal.fanParts.map(p => p[0] + '+' + p[1]).join('、') }}）</div>
                <div v-if="g.lastWin" class="line-sub">底 10 × {{ g.lastWin.fan }} 番{{ g.lastWin.selfDrawn ? ' × 自摸2' : '' }} → {{ g.lastWin.selfDrawn ? '三家各付 ' + g.lastWin.pay : NAMES[g.lastWin.from] + ' 付 ' + g.lastWin.pay }}</div>
                <div v-if="sess.lastHandChip && sess.lastHandChip.total > 0" class="line-sub chipnote">桌面词条资助 +{{ sess.lastHandChip.total }}（旁路台账 · 不影响零和计分）</div>
                <span v-else-if="!sess?.over" class="dim">1.2 秒后开下一局…</span>
              </div>
            </div>

            <div class="mj-seat mj-side" :class="{ act: mh.activeSeat === 3 }">
              <span class="mj-name">{{ NAMES[3] }}<em v-if="g.dealer === 3">庄</em><span v-if="g.hands[3].length <= 7" class="report-badge">余 {{ g.hands[3].length }}</span></span>
              <span class="mj-cnt">手 {{ g.hands[3].length }}</span>
              <span class="mj-discard" v-if="g.discards[3].length">
                <b v-for="(t, i) in g.discards[3].slice(-8)" :key="i === g.discards[3].slice(-8).length - 1 ? 'L' + g.discards[3].length : i" class="mj-d" :class="{ last: i === g.discards[3].slice(-8).length - 1 }">{{ TILE_CN[t] }}</b>
              </span>
              <span class="mj-meld" v-for="(md, i) in g.melds[3]" :key="'m' + i" :class="{ last: i === g.melds[3].length - 1 }">{{ meldLabel(md) }}</span>
            </div>
          </div>

          <!-- 自家：手牌 -->
          <div class="mj-me" :class="{ act: mh.activeSeat === 0 }">
            <div class="mj-name you">你（点 1 张打出）<em v-if="g.dealer === 0">庄</em><span v-if="g.hands[0].length <= 7" class="report-badge">余 {{ g.hands[0].length }}</span></div>
            <div class="mj-turnhint" :class="{ you: mh.kind === 'your-turn' }" v-if="mh.kind === 'your-turn' || mh.kind === 'ai-turn'">{{ claimWait ? claimWait : (mh.kind === 'your-turn' ? '轮到你打牌' : `等待 ${NAMES[mh.activeSeat]} 出牌`) }}</div>
            <div class="mj-tenpai" v-if="myTenpai.length">听 <b v-for="t in myTenpai" :key="t">{{ TILE_CN[t] }}</b></div>
            <div class="mj-tiles">
              <button v-for="(t, i) in g.hands[0]" :key="i" class="mj-tile" :class="{ dim: !canDiscard, hot: canDiscard }" @click="clickTile(t)">
                <b>{{ g.hands[0].filter(x => x === t).length > 1 ? g.hands[0].filter(x => x === t).length : '' }}</b>
                <span>{{ TILE_CN[t] }}</span>
              </button>
            </div>
            <div class="mj-meld" v-if="g.melds[0].length">
              <span v-for="(md, i) in g.melds[0]" :key="i" :class="{ last: i === g.melds[0].length - 1 }">{{ meldLabel(md) }}</span>
            </div>
            <!-- v1.52 自家牌河（补齐：三家 AI 都有弃牌河，唯独自己缺失，测试无法复盘自己的打法） -->
            <span class="mj-discard mine" v-if="g.discards[0].length">
              <span class="mj-river-label">你·牌河</span>
              <b v-for="(t, i) in g.discards[0].slice(-8)" :key="'me' + i" class="mj-d" :class="{ last: i === g.discards[0].slice(-8).length - 1 }">{{ TILE_CN[t] }}</b>
            </span>
          </div>
        </div>

        <!-- 整场终局排名屏 -->
        <div class="mj-final" v-if="S.phase === 'result' && sess">
          <div class="big">🏁 整场结束 · 冠军 <b>{{ NAMES[sess.champ] }}</b>（{{ sess.total[sess.champ] >= 0 ? '+' : '' }}{{ sess.total[sess.champ] }} 分）</div>
          <div class="line" v-for="(i, k) in rankings" :key="i">
            <b>{{ k + 1 }}</b> {{ NAMES[i] }} · 累计 {{ sess.total[i] >= 0 ? '+' : '' }}{{ sess.total[i] }} · 胡 {{ sess.wins[i] }} 局
          </div>
          <button class="btn primary" @click="S.phase = 'menu'; newSession()">再来一整场</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style>
.mj .table-wrap { min-height: 100vh; display: flex; flex-direction: column; gap: 6px;
  background: radial-gradient(120% 90% at 50% 20%, #3e8e6a 0%, #1f5c43 60%, #143c2f 100%);
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); color: #f1faee; }
.mj .topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mj .topbar .title { font-size: 16px; font-weight: 800; }
.mj .chip { font-size: 12px; color: #c3dccd; background: rgba(9,38,29,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 999px; padding: 3px 10px; }
.mj .chip b { color: #f2b21b; }
.mj .btn { border: 2px solid var(--ink); border-radius: 0; padding: 7px 16px; font-size: 13px; font-weight: 900; cursor: pointer; background: #12453a; color: #f1faee; box-shadow: 0 3px 0 var(--ink); }
.mj .btn:active { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }
.mj .btn.primary { background: #f2b21b; color: #3a2c00; }
.mj .btn.ghost { background: transparent; border: 2px solid rgba(255,255,255,.25); box-shadow: none; }
.mj .btn.tiny { padding: 4px 10px; font-size: 12px; }
.mj .btn.on { background: #f2b21b; color: #3a2c00; }
.mj .chip.offline { font-size: 11px; padding: 2px 8px; border-color: rgba(255,255,255,.2); background: rgba(255,255,255,.05); color: #c3dccd; }
.mj .chip.term { border-color: rgba(242,178,27,.5); background: rgba(242,178,27,.12); color: #ffe8b3; font-size: 11px; }
.mj .settle .chipnote, .mj .line-sub.chipnote { color: #f2b21b; font-size: 11px; }
.mj .chip.lvl { border-color: rgba(255,150,80,.5); color: #ffd9b3; }
.mj .chip.lead { border-color: rgba(126,231,135,.5); color: #7ee787; }
/* v1.39 整场进度条 + 本局事件流（对齐牛牛记分牌 / 德州下注日志） */
.mj .mj-prog { display: flex; align-items: center; gap: 6px; width: 100%; max-width: 240px; }
.mj .mj-prog-track { flex: 1; height: 4px; background: rgba(255,255,255,.12); border-radius: 3px; overflow: hidden; }
.mj .mj-prog-track i { display: block; height: 100%; background: #f2b21b; transition: width .3s; }
.mj .mj-prog-label { font-size: 10px; color: #c3dccd; white-space: nowrap; }
.mj .mj-hlog { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; max-width: 320px; }
.mj .mj-hlog-chip { font-size: 10px; color: #c3dccd; background: rgba(9,38,29,.5); border-radius: 999px; padding: 1px 7px; }
.mj .mj-hlog-chip:last-child { color: #f2b21b; border: 1px solid rgba(242,178,27,.4); }
.mj .lv-row { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
.mj .lv-row .dim { font-size: 12px; }
.mj .lv-row .btn.tiny { padding: 3px 10px; font-size: 12px; }
.mj .lv-row .btn.on { background: #f2b21b; color: #3a2c00; }
.mj .dim { color: #c3dccd; font-size: 11px; }
.mj .hh-tag { font-size: 11px; color: #c3dccd; }

.menu-panel { text-align: left; padding: 14px; background: rgba(9,38,29,.55); border-radius: 14px; }
.menu-panel h3 { margin: 0 0 4px; font-size: 18px; }
.menu-panel .slogan { font-size: 12px; color: #c3dccd; margin-bottom: 8px; }
.menu-panel ul { margin: 8px 0 12px; padding-left: 18px; font-size: 12.5px; color: #c3dccd; line-height: 1.6; }

/* 牌桌方位：对家上、左右两侧、自家下 */
.mj .mj-arena { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.mj .mj-seat { background: rgba(9,38,29,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 4px 8px; }
.mj .mj-seat.act { border-color: #f2b21b; box-shadow: 0 0 0 2px rgba(242,178,27,.3); }
.mj .mj-me.act { border: 1px solid rgba(242,178,27,.5); box-shadow: 0 0 0 2px rgba(242,178,27,.28); border-radius: 4px; padding: 4px 6px; }
.mj .mj-turnhint { font-size: 12px; font-weight: 700; color: #f2b21b; }
.mj .mj-hint { font-size: 11.5px; color: #7ee787; font-weight: 700; }
.mj .mj-turnhint.you { color: #7ee787; }
.mj .mj-top { display: flex; align-items: center; gap: 8px; justify-content: center; flex-wrap: wrap; }
.mj .mj-mid { display: grid; grid-template-columns: 150px 1fr 150px; gap: 8px; align-items: center; }
.mj .mj-side { display: flex; flex-direction: column; gap: 4px; }
.mj .mj-name { font-size: 12px; font-weight: 700; color: #c3dccd; }
.mj .mj-name.you { color: #f2b21b; }
.mj .mj-name em { font-style: normal; color: #f2b21b; margin-left: 4px; font-size: 11px; }
.mj .report-badge { margin-left: 6px; padding: 1px 6px; border-radius: 8px; background: rgba(242,178,27,.18); border: 1px solid rgba(242,178,27,.55); color: #f2b21b; font-size: 10px; font-weight: 700; }
.mj .mj-cnt { font-size: 11px; color: #c3dccd; }
.mj .mj-tenpai { font-size: 11px; color: #7ee787; }
.mj .mj-tenpai b { font-weight: 700; margin: 0 2px; color: #a6f3ac; }
/* 弃牌河：每家最近 8 张小牌流，最新一张高亮（v1.52 字号放大：测试/复盘可读性） */
.mj .mj-discard { display: flex; gap: 3px; flex-wrap: wrap; max-width: 220px; align-items: center; }
.mj .mj-river-label { font-size: 10px; color: #8fb8a8; margin-right: 2px; }
.mj .mj-d { min-width: 22px; font-size: 11px; font-weight: 700; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15); border-radius: 4px; display: grid; place-items: center; color: #c3dccd; padding: 2px 3px; writing-mode: vertical-rl; letter-spacing: 1px; }
.mj .mj-d.last { background: rgba(242,178,27,.22); border-color: rgba(242,178,27,.6); color: #f2b21b; }
.mj .mj-meld { font-size: 12px; padding: 2px 7px; border-radius: 4px; background: rgba(255,255,255,.08); color: #c3dccd; }
.mj .mj-meld.last { border: 1px solid rgba(242,178,27,.6); color: #f2b21b; }
/* v1.52 胡牌展示：赢家 14 张小牌流 + 胡牌张高亮 */
.mj .wj-tile { display: inline-block; min-width: 22px; font-size: 11px; font-weight: 700; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.2); border-radius: 4px; padding: 2px 3px; color: #f1faee; }
.mj .wj-tile.win { background: rgba(126,231,135,.25); border-color: rgba(126,231,135,.7); color: #a6f3ac; }
.mj .mj-winline { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; margin: 4px 0; max-width: 340px; }
.mj .mj-center { text-align: center; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.mj .mj-wall { font-size: 12px; color: #c3dccd; }
.mj .mj-wall b { color: #f2b21b; }
.mj .mj-last { font-size: 12px; color: #c3dccd; }
.mj .mj-last b { color: #f2b21b; }
.mj .mj-listen { font-size: 11px; color: #7ee787; }
.mj .mj-listen b { color: #a6f3ac; font-weight: 700; margin: 0 3px; }
.mj .mj-actions { display: flex; gap: 6px; align-items: center; }
.mj .mj-status { text-align: center; }
.mj .mj-status .line-big { font-size: 15px; font-weight: 800; color: #f2b21b; }
.mj .mj-status .line-sub { font-size: 11px; color: #c3dccd; margin-top: 2px; }

/* 自家手牌：单行自适应（13/14 张在屏宽内不叠死）；tile 宽走 --mj-tw，随屏宽收缩保证 14 张完整放下 */
.mj .mj-me { display: flex; flex-direction: column; gap: 5px; align-items: center; }
/* v1.52：牌宽随屏宽自适应（14 张不溢出/不堆叠）——宽屏封顶 46px，窄屏收缩到 (100vw-48px)/14 */
.mj { --mj-tw: min(46px, calc((100vw - 48px) / 14)); }
.mj .mj-tiles { display: flex; flex-wrap: nowrap; width: 100%; align-self: stretch; overflow: visible; padding: 2px; justify-content: center; }
/* width:100%/align-self:stretch 显式定宽：.mj-tiles 是 flex item，auto 宽会让 clamp 内 100% 循环解析成内容宽（曾 13 张全叠死） */
.mj .mj-tile { position: relative; width: var(--mj-tw); height: calc(var(--mj-tw) * 1.35); border: 1.5px solid #d9d9cf; border-radius: 6px; background: #fdfdfb; color: #22303a; font-size: 11px; font-weight: 700; cursor: pointer; flex: 0 0 auto; }
.mj .mj-tile + .mj-tile { margin-left: clamp(calc((100% - 14 * var(--mj-tw)) / 13), calc(-1 * var(--mj-tw)), 0px); }
.mj .mj-tile.hot { border-color: #f2b21b; box-shadow: 0 2px 6px rgba(242,178,27,.3); }
.mj .mj-tile.dim { opacity: .5; cursor: default; }
.mj .mj-tile b { position: absolute; top: 1px; left: 3px; font-size: 10px; color: #d64550; }
.mj .mj-tile span { position: absolute; inset: 0; display: grid; place-items: center; writing-mode: vertical-rl; letter-spacing: 2px; }

/* 终场排名 */
.mj .mj-final { text-align: center; background: rgba(9,38,29,.6); border: 1px solid rgba(242,178,27,.4); border-radius: 14px; padding: 14px; }
.mj .mj-final .big { font-size: 17px; font-weight: 800; color: #f2b21b; }
.mj .mj-final .line { font-size: 13px; color: #c3dccd; margin-top: 4px; }

/* 手机横屏（≤480px 高）：一屏放下 */
@media (orientation: landscape) and (max-height: 480px) {
  .mj .table-wrap { min-height: 0; height: var(--vh, 100vh); overflow-y: auto; gap: 4px; padding: 6px 8px calc(4px + env(safe-area-inset-bottom)); }
  .mj .topbar { gap: 6px; }
  .mj .topbar .chip { font-size: 11px; padding: 2px 8px; }
  .mj .topbar .title { font-size: 14px; }
  .mj .mj-mid { grid-template-columns: 128px 1fr 128px; gap: 6px; }
  .mj { --mj-tw: min(38px, calc((100vw - 48px) / 14)); }
  .mj .mj-tile { font-size: 10px; }
  .mj .mj-d { font-size: 9px; min-width: 15px; }
  .mj .mj-discard { max-width: 170px; }
  .mj .mj-hlog { max-width: 220px; }
  .mj .mj-prog { max-width: 180px; }
  .mj .btn { padding: 5px 12px; font-size: 12px; }
}

/* 小竖屏（≤400px 宽）：侧栏/弃牌河/手牌收窄，禁止横向溢出 */
@media (max-width: 400px) {
  .mj .table-wrap { padding: 8px; }
  .mj .mj-mid { grid-template-columns: 88px 1fr 88px; gap: 4px; }
  .mj .mj-seat { padding: 3px 5px; }
  .mj .mj-name { font-size: 11px; }
  .mj .report-badge { margin-left: 3px; padding: 0 4px; font-size: 9px; }
  .mj .mj-discard { max-width: 84px; }
  .mj .mj-d { min-width: 13px; font-size: 9px; padding: 0 1px; }
  .mj { --mj-tw: 36px; }
  .mj .mj-tile { font-size: 10px; }
  .mj .mj-actions { flex-wrap: wrap; }
  .mj .btn { padding: 5px 10px; font-size: 12px; }
}
</style>
