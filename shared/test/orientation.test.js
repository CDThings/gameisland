/**
 * 自动横屏决策层（v1.54）：orientationPlan / lockMethod / fitScale / handWrapGeometry 纯函数。
 * 钉死行为矩阵：竖屏窄=提示、横屏=不提示、锁定态不提示；锁定方式选择；缩放钳位；手牌换行几何。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { orientationPlan, lockMethod, fitScale, handWrapGeometry } from '../src/orientation.js';

test('orientationPlan：牌桌页竖屏窄（手机 390×844）→ 需旋转', () => {
  const p = orientationPlan({ vw: 390, vh: 844, isTable: true });
  assert.equal(p.needRotate, true);
  assert.equal(p.reason, 'portrait-narrow');
});

test('orientationPlan：横屏（844×390）→ 不提示', () => {
  const p = orientationPlan({ vw: 844, vh: 390, isTable: true });
  assert.equal(p.needRotate, false);
  assert.equal(p.reason, 'landscape-ok');
});

test('orientationPlan：宽竖屏（iPad 768×1024）不强劝（超出 maxPortraitW 820 以内为小屏；1024 宽超界）', () => {
  // 注意：vw=1024 > maxPortraitW(820) 且竖屏 → 不提示
  assert.equal(orientationPlan({ vw: 1024, vh: 768, isTable: true }).needRotate, false);
});

test('orientationPlan：锁定态 / 非牌桌页 → 不提示', () => {
  assert.equal(orientationPlan({ vw: 390, vh: 844, isTable: true, locked: true }).needRotate, false);
  assert.equal(orientationPlan({ vw: 390, vh: 844, isTable: false }).needRotate, false);
});

test('lockMethod：全屏+lock 可用且竖屏 → fullscreen-lock；仅竖屏无能力 → rotate-hint；横屏 → none', () => {
  assert.equal(lockMethod({ hasLock: true, hasFullscreen: true, orientation: 'portrait', needRotate: true }), 'fullscreen-lock');
  assert.equal(lockMethod({ hasLock: false, hasFullscreen: false, orientation: 'portrait', needRotate: true }), 'rotate-hint');
  assert.equal(lockMethod({ hasLock: true, hasFullscreen: true, orientation: 'landscape', needRotate: false }), 'none');
});

test('fitScale：同时放下宽高且钳位 [min,max]', () => {
  // 844×390 视口 vs 自然 1024×520：min(844/1024, 390/520)=min(0.824,0.75)=0.75
  assert.ok(Math.abs(fitScale(844, 390, 1024, 520) - 0.75) < 1e-9);
  // 钳位下限：极小视口 320×360 vs 1024×520 → 0.3125 → 钳到 0.5
  assert.equal(fitScale(320, 360, 1024, 520, 0.5, 1), 0.5);
  // 钳位上限：大视口 1440×900 vs 1024×520 → 1.406 → 钳到 1
  assert.equal(fitScale(1440, 900, 1024, 520, 0.5, 1), 1);
  // 非法尺寸 → 1（不缩放）
  assert.equal(fitScale(0, 390, 1024, 520), 1);
});

test('handWrapGeometry：27 张宽屏一行放下（不重叠）', () => {
  // availW=1240, 27 张 → 单张 45.9 ≥ minCardW 18 → 一行，牌宽 min(64, 45.9)=45.9
  const g = handWrapGeometry(1240, 27);
  assert.equal(g.rows, 1);
  assert.equal(g.perRow, 27);
  assert.equal(g.overlap, false);
  assert.ok(Math.abs(g.cardW - 1240 / 27) < 1e-9);
});

test('handWrapGeometry：27 张手机竖屏 330 可用宽 → 两行 14/13，牌宽均分钳位', () => {
  // availW=330, 27 张 → 一行 12.2 < 18 → 两行 perRow=14, cardW=max(18, min(64, 330/14=23.6))=23.6
  const g = handWrapGeometry(330, 27);
  assert.equal(g.rows, 2);
  assert.equal(g.perRow, 14);
  assert.equal(g.overlap, false);
  assert.ok(Math.abs(g.cardW - 330 / 14) < 1e-9);
});

test('handWrapGeometry：极窄（200 可用 27 张）→ 两行但牌宽触下限 18 → overlap=true', () => {
  // 330→200: perRow=14, 200/14=14.3 < 18 → cardW 钳到 18 > 份额 14.3 → overlap
  const g = handWrapGeometry(200, 27);
  assert.equal(g.rows, 2);
  assert.equal(g.cardW, 18);
  assert.equal(g.overlap, true);
});

test('handWrapGeometry：麻将 14 张 330 宽 → 一行', () => {
  const g = handWrapGeometry(330, 14);
  assert.equal(g.rows, 1);
  assert.equal(g.perRow, 14);
});

test('handWrapGeometry：非法入参 → 安全退化（不崩）', () => {
  assert.deepEqual(handWrapGeometry(0, 27), { perRow: 27, cardW: 0, rows: 27, overlap: false });
});
