<template>
  <div class="island">
    <!-- 品牌瓦片（暖纸日常风微倾瓦片） -->
    <div class="i-brand">
      <div class="i-tile">
        <svg class="i-tile-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 7h10a5 5 0 0 1 5 5v1a3.5 3.5 0 0 1-3.5 3.5h-13A3.5 3.5 0 0 1 2 13v-1a5 5 0 0 1 5-5Z"/>
          <path d="M8 10.5v4M6 12.5h4"/>
          <path d="M15.5 11h.01M18 13.5h.01"/>
        </svg>
      </div>
      <div class="i-kicker">GAME ISLAND</div>
      <h1 class="i-title">来一局？</h1>
      <div class="i-sub">牌桌 · 亲子小游戏 · 纯离线可玩</div>
    </div>

    <!-- 身份状态胶囊（仅当 URL 携带身份/访客参数时出现；插件场景默认无参不显示） -->
    <div v-if="authState" :class="['i-auth', 'i-auth--' + authTone]">{{ authState }}</div>

    <!-- 牌桌卡 2×2（纸白卡 + 色调 icon tile） -->
    <div class="i-grid">
      <div class="i-cell" v-for="t in tables" :key="t.id" @click="go(t.id)">
        <div :class="['i-tile2', 'i-tile2--' + t.tone]" v-html="iconSvg(t.icon)"></div>
        <div class="i-name">
          {{ t.name }}
          <svg class="i-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </div>
        <div class="i-desc">{{ t.desc }}</div>
      </div>
    </div>

    <!-- 亲子小游戏专区（纯本地零 API，离线可玩） -->
    <div class="i-sechead">
      <span class="i-sec-t">亲子小游戏</span>
      <span class="i-sec-s">大人小孩一起玩 · 大按钮大字体</span>
    </div>
    <div class="i-grid i-grid-kids">
      <div class="i-cell" v-for="(k, i) in kidGames" :key="k.id" :class="{ 'i-cell--wide': i === kidGames.length - 1 }" @click="goKid(k.id)">
        <div :class="['i-tile2', 'i-tile2--' + k.tone]" v-html="iconSvg(k.icon)"></div>
        <div class="i-name">
          {{ k.name }}
          <svg class="i-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </div>
        <div class="i-desc">{{ k.desc }}</div>
        <div v-if="kidRecs[k.id]" class="i-rec">{{ kidRecs[k.id] }}</div>
      </div>
    </div>

    <div class="i-foot">和重要的人，一起玩一局</div>
  </div>
</template>

<script>
// 游戏岛首页（插件线）：四牌桌=纯本地状态机（零 API、零网络权限），亲子六款同模式。
// 身份胶囊保留 hash 参数兼容（guest/ticket/uid）；插件场景默认无参 → 无胶囊。
import { KID_GAMES as KID_META, loadKidRecord } from '../kids/registry.js';
const TABLES = [
  { id: 'guandan', icon: 'guandan', tone: 'coral', name: '掼蛋', desc: '组队配合 · 最完整参照系' },
  { id: 'niuniu', icon: 'niuniu', tone: 'orange', name: '牛牛', desc: '比牌互赔 · 快节奏' },
  { id: 'holdem', icon: 'holdem', tone: 'blue', name: '德州扑克', desc: 'Position · 心理博弈' },
  { id: 'mahjong', icon: 'mahjong', tone: 'green', name: '麻将', desc: '推倒胡 · 番数制' },
];

// 亲子小游戏六款（#/kids/<id>，KidHost 承载，纯本地零 API；棋类支持人机/多人同屏）
const KID_GAMES = [
  { id: 'whack', icon: 'hammer', tone: 'coral', name: '打地鼠', desc: '看谁手快 · 反应力' },
  { id: 'fishing', icon: 'fish', tone: 'blue', name: '小猫钓鱼', desc: '人机 / 2-4 人同屏' },
  { id: 'mines', icon: 'flag', tone: 'green', name: '扫雷', desc: '数字推理 · 小小侦探' },
  { id: 'checkers', icon: 'pegs', tone: 'orange', name: '跳棋', desc: '人机 / 2-4 人同屏' },
  { id: 'ludo', icon: 'dice', tone: 'coral', name: '飞行棋', desc: '人机 / 2-4 人同屏' },
  { id: 'gomoku', icon: 'gomoku', tone: 'purple', name: '五子棋', desc: '人机 / 2 人同屏' },
];

// 24 viewBox · stroke 2 圆头线性图标
const ICONS = {
  guandan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="10" height="15" rx="2"/><rect x="10" y="7" width="10" height="15" rx="2"/><circle cx="15" cy="14.5" r="1.4"/></svg>',
  niuniu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="10" width="8" height="11" rx="1.5" transform="rotate(-14 6.5 21)"/><rect x="8" y="8" width="8" height="11" rx="1.5"/><rect x="13.5" y="10" width="8" height="11" rx="1.5" transform="rotate(14 17.5 21)"/></svg>',
  holdem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c-3.2 3.8-5.5 6.4-5.5 9.2a3.1 3.1 0 0 0 5.9 1.2h1.2a3.1 3.1 0 0 0 5.9-1.2C19.5 8.9 17.2 6.3 14 2.5Z"/><path d="M12 13.5V21M8.5 21h7"/></svg>',
  mahjong: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="3.5" width="13" height="17" rx="2.5"/><path d="M8.5 8.5h7M12 8.5v3M12 11.5 9 17.5M12 11.5l3 6"/></svg>',
  hammer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6 4 4"/><path d="M9.5 4.5 6 8l7.5 7.5c.8.8 2 .8 2.8 0l1.7-1.7c.8-.8.8-2 0-2.8L11.5 4.5c-.8-.8-2-.8-2.8 0Z" transform="rotate(0)"/><path d="m6 8-2.5 2.5 7.5 7.5L13.5 15.5"/><circle cx="18.5" cy="4" r="1.6"/></svg>',
  fish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c2.5-4 6.5-6 10-6 3 0 5.5 1.5 7 3.5.6.8.6 1.7 0 2.5-1.5 2-4 3.5-7 3.5-3.5 0-7.5-2-10-3.5Z"/><path d="M19.5 9.5c1.5-.5 2.5-1.5 3-3-1.8 0-3 .3-4 1"/><circle cx="16" cy="10.5" r="0.6" fill="currentColor"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h13l-2.5 3.5L18 11H5"/></svg>',
  pegs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6" r="2.6"/><circle cx="6.5" cy="16.5" r="2.6"/><circle cx="17.5" cy="16.5" r="2.6"/><path d="M10.5 8.2 8 14.2M13.5 8.2l2.5 6M9.1 16.5h5.8"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/></svg>',
  // 五子棋（对角五连，一眼可读）
  gomoku: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 4" opacity="0.4"/><circle cx="4" cy="20" r="2.3" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="2.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="2.3" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="2.3" fill="currentColor" stroke="none"/></svg>',
};

export default {
  data() {
    return { tables: TABLES, kidGames: KID_GAMES, ICONS, authState: '', kidRecs: {} };
  },
  computed: {
    authTone() {
      if (this.authState.startsWith('✓')) return 'green';
      if (this.authState.startsWith('访客离线') || this.authState.startsWith('票据验证需要网络')) return 'orange';
      return 'coral';
    },
  },
  mounted() {
    this.kidRecs = this.buildKidRecs();
    // 授权参数接收（兼容宿主深链携一次性票据 + 身份参数；票据从 hash 段解析）
    const q = new URLSearchParams(location.hash.split("?")[1] || "");
    const ticket = q.get('ticket');
    const uid = q.get('uid');
    const name = q.get('name');
    const api = q.get('api') || '';
    if (q.get('guest') === '1') {
      // 访客/离线模式：不消费票据，本地玩法零依赖
      this.authState = '访客离线模式 · 本地玩法不受影响';
      return;
    }
    if (ticket && uid) {
      // 票据单次消费，同实例双挂载不得重复验证；同票有记忆则直接复用身份
      let memo = null;
      try { memo = JSON.parse(sessionStorage.getItem('island.auth') || 'null'); } catch (e) { /* ignore */ }
      if (memo && memo.code === ticket && memo.userId) {
        this.authState = '✓ 已绑定：' + (name || memo.userName || 'player') + '（#' + memo.userId + '）';
        return;
      }
      fetch(api + '/api/v1/game/ticket/verify?code=' + ticket)
        .then((r) => r.json())
        .then((j) => {
          const d = j.data || {};               // 统一信封：解包 data
          if (d.verified) {
            this.authState = '✓ 已绑定：' + (name || d.userName || 'player') + '（#' + (d.userId || Number(uid)) + '）';
            try { sessionStorage.setItem('island.auth', JSON.stringify({ code: ticket, userId: d.userId || Number(uid), userName: d.userName || name })); } catch (e) { /* ignore */ }
          } else {
            this.authState = '票据验证未通过（可返回重进刷新）';
          }
        })
        .catch(() => { this.authState = '票据验证需要网络（离线模式下本地玩法不受影响）'; });
    } else if (uid) {
      this.authState = '✓ 身份：' + (name || 'player') + '（#' + uid + '）';
    }
  },
  methods: {
    iconSvg(name) { return this.ICONS[name] || ''; },
    buildKidRecs() {
      const out = {};
      for (const k of Object.values(this.kidGames)) {
        const m = KID_META[k.id];
        if (!m || !m.recordType) continue;
        const r = loadKidRecord(k.id) || {};
        let text = '';
        if (m.recordType === 'wins') text = r.wins ? (m.recordText || '胜 {n} 场').replace('{n}', String(r.wins)) : '';
        else if (r.best != null) text = (m.recordText || '').replace('{n}', String(r.best));
        if (text) out[k.id] = text;
      }
      return out;
    },
    go(id) { this.$router.push('/cards/' + id); },
    goKid(id) { this.$router.push('/kids/' + id); },
  },
};
</script>

<style>
/* 暖纸日常（token 见 style.css :root）；单位用 px——纯 Vite 工程，rpx 无效 */
.island {
  position: fixed;
  inset: 0;
  overflow-y: auto;
  background: var(--hn-bg, #F0E8DC);
  padding: calc(var(--sbh, env(safe-area-inset-top, 0px)) + 56px) 18px 0;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
  color: var(--hn-ink, #2F2C27);
  box-sizing: border-box;
}

/* 品牌区 */
.i-brand { text-align: center; }
.i-tile {
  width: 68px; height: 68px;
  border-radius: 24px;
  background: var(--hn-sand, #E9E0D3);
  display: flex; align-items: center; justify-content: center;
  transform: rotate(-4deg);
  box-shadow: 0 8px 18px rgba(86, 66, 43, 0.08);
  margin: 0 auto;
  color: #547D62;
}
.i-tile-svg { width: 34px; height: 34px; }
.i-kicker { margin-top: 18px; font-size: 12px; letter-spacing: 4px; color: #82786B; }
.i-title { margin: 10px 0 0; font-size: 34px; font-weight: 700; line-height: 1.22; letter-spacing: -0.03em; color: var(--hn-ink, #2F2C27); }
.i-sub { margin: 12px auto 0; max-width: 280px; font-size: 14px; line-height: 1.8; color: var(--hn-muted, #777168); }

/* 身份状态胶囊 */
.i-auth {
  margin: 20px auto 0;
  width: fit-content;
  max-width: 92%;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 12px; font-weight: 650;
  text-align: center;
}
.i-auth--green { background: var(--hn-green-soft, #E5F1E8); color: var(--hn-green-deep, #397D59); }
.i-auth--orange { background: var(--hn-orange-soft, #F9EBD8); color: var(--hn-orange-deep, #A96D1E); }
.i-auth--coral { background: var(--hn-coral-soft, #F8E7DF); color: var(--hn-coral-deep, #B65F3B); }

/* 牌桌卡 2×2 */
.i-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 28px; }
.i-cell {
  background: var(--hn-paper, #FFFCF7);
  border: 1px solid rgba(231, 220, 203, 0.85);
  border-radius: 20px;
  padding: 18px 16px 16px;
  box-shadow: var(--hn-shadow-card, 0 8px 22px rgba(86, 66, 43, 0.045));
  cursor: pointer;
  text-align: left;
  transition: transform 0.12s ease;
}
.i-cell:active { transform: scale(0.985); }
.i-tile2 {
  width: 39px; height: 39px;
  border-radius: 13px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 13px;
}
.i-tile2 svg { width: 22px; height: 22px; display: block; }
.i-tile2--coral { background: var(--hn-coral-soft, #F8E7DF); color: var(--hn-coral, #E0784A); }
.i-tile2--orange { background: var(--hn-orange-soft, #F9EBD8); color: var(--hn-orange-deep, #A96D1E); }
.i-tile2--blue { background: var(--hn-blue-soft, #E4EEF6); color: var(--hn-blue, #4A90C4); }
.i-tile2--green { background: var(--hn-green-soft, #E5F1E8); color: var(--hn-green, #3E9B6E); }
.i-tile2--purple { background: #F0E9FD; color: #7C5CD6; }
.i-name {
  display: flex; align-items: center; gap: 4px;
  font-size: 16px; font-weight: 600; color: var(--hn-ink, #2F2C27);
}
.i-chev { width: 14px; height: 14px; color: var(--hn-faint, #A69D91); flex-shrink: 0; }
.i-desc { margin-top: 6px; font-size: 12px; line-height: 1.5; color: var(--hn-muted, #777168); }
.i-rec { display: inline-flex; margin-top: 8px; border-radius: 999px; padding: 2px 9px; font-size: 10px; font-weight: 800; letter-spacing: 0.02em; background: var(--hn-green-soft, #E5F1E8); color: var(--hn-green-deep, #397D59); }

/* 手机横屏：牌桌 4 列一行、亲子 3 列，头区收紧，少滚动快触达 */
@media (orientation: landscape) and (max-height: 500px) {
  .island { padding: calc(var(--sbh, env(safe-area-inset-top, 0px)) + 44px) 20px 0; }
  .i-title { font-size: 26px; margin-top: 6px; }
  .i-sub { margin-top: 8px; }
  .i-grid { grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 18px; }
  .i-grid-kids { grid-template-columns: repeat(3, 1fr); }
  .i-cell { padding: 13px 13px 12px; border-radius: 16px; }
  .i-cell--wide { grid-column: span 3; }
}

/* 页脚 */
.i-foot {
  text-align: center;
  padding: 32px 0 24px;
  font-size: 10px; letter-spacing: 0.5px;
  color: var(--hn-faint, #A69D91);
}

/* 亲子小游戏专区 */
.i-sechead {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-top: 30px; padding: 0 4px;
}
.i-sec-t { font-size: 17px; font-weight: 800; color: var(--hn-ink, #2F2C27); letter-spacing: -0.01em; }
.i-sec-s { font-size: 11px; color: var(--hn-faint, #A69D91); }
.i-grid-kids { margin-top: 12px; }
.i-cell--wide { grid-column: 1 / -1; }
</style>
