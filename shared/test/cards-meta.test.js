/**
 * 桌面词条 chip 纯函数测试（v1.15）
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { rollChips, applyChip, formatChipDisplay } from '../src/cards/meta.js';

// ── 确定性：同 seed + gameId → 同 chips ───────────────────────────────────────
test('rollChips 确定性：同 seed 同 gameId 返回相同 chip', () => {
  const r1 = rollChips('seed-abc', 'guandan');
  const r2 = rollChips('seed-abc', 'guandan');
  assert.deepEqual(r1.map(c => c.id), r2.map(c => c.id));
});

test('rollChips 不同 seed → 不同 chips（至少一次不同）', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    seen.add(JSON.stringify(rollChips('seed-' + i, 'holdem').map(c => c.id)));
  }
  assert.ok(seen.size > 1, '不同 seed 应产生不同 chips');
});

// ── chip 数量：每局 1~2 张 ─────────────────────────────────────────────────────
test('rollChips 返回 1 或 2 张 chip', () => {
  for (let i = 0; i < 50; i++) {
    const n = rollChips('r' + i, 'mahjong').length;
    assert.ok(n === 1 || n === 2, `预期 1 或 2 张，实际 ${n}`);
  }
});

test('rollChips 不会重复同一 chip', () => {
  for (let i = 0; i < 100; i++) {
    const chips = rollChips('dup' + i, 'niuniu');
    const ids = chips.map(c => c.id);
    assert.equal(ids.length, new Set(ids).size, '不应有重复 id');
  }
});

// ── chip 池覆盖：每种游戏都有 chip ─────────────────────────────────────────────
test('四种游戏各有 chip 池', () => {
  for (const gid of ['guandan', 'holdem', 'mahjong', 'niuniu']) {
    const chips = rollChips('poolcheck', gid);
    assert.ok(chips.length > 0, gid + ' 应有 chip');
    assert.ok(chips.every(c => c.gameId === gid), gid + ' chip gameId 应匹配');
  }
});

test('未知 gameId 返回空数组', () => {
  assert.deepEqual(rollChips('seed', 'unknown-game'), []);
});

// ── applyChip：mult 累乘、base/bonus 累加 ──────────────────────────────────────
test('applyChip mult 累乘：两个 ×1.1  →  ×1.21', () => {
  const chips = [
    { id: 'c1', effect: 'mult', value: 1.1, name: 'A' },
    { id: 'c2', effect: 'mult', value: 1.1, name: 'B' },
  ];
  const r = applyChip({}, chips);
  assert.ok(Math.abs(r.multBonus - 1.21) < 0.001, `multBonus=${r.multBonus}`);
  assert.equal(r.scoreBonus, 0);
});

test('applyChip base + bonus 累加', () => {
  const chips = [
    { id: 'b1', effect: 'base', value: 5, name: '保底' },
    { id: 'b2', effect: 'bonus', value: 3, name: '幸运' },
  ];
  const r = applyChip({}, chips);
  assert.equal(r.scoreBonus, 8);
});

test('applyChip mult + base 混合', () => {
  const chips = [
    { id: 'm1', effect: 'mult', value: 1.2, name: '加成' },
    { id: 'b1', effect: 'base', value: 4, name: '保底' },
  ];
  const r = applyChip({}, chips);
  assert.ok(Math.abs(r.multBonus - 1.2) < 0.001);
  assert.equal(r.scoreBonus, 4);
});

// ── applyChip 条件触发 ──────────────────────────────────────────────────────────
test('applyChip 条件 chip：不满足时跳过', () => {
  const chip = { id: 'c', effect: 'bonus', value: 10, condFn: (r) => r.flag, name: 'X' };
  const r = applyChip({ flag: false }, [chip]);
  assert.equal(r.scoreBonus, 0);
  assert.equal(r.active.length, 0);
});

test('applyChip 条件 chip：满足时生效', () => {
  const chip = { id: 'c', effect: 'bonus', value: 10, condFn: (r) => r.flag, name: 'X' };
  const r = applyChip({ flag: true }, [chip]);
  assert.equal(r.scoreBonus, 10);
  assert.equal(r.active.length, 1);
});

// ── 结算计算示例（完整示例：baseScore × multBonus + scoreBonus）────────────────
test('applyChip 结算示例：base 100 × 1.21 + 8 = 129', () => {
  const chips = [
    { id: 'm1', effect: 'mult', value: 1.1, name: 'A' },
    { id: 'm2', effect: 'mult', value: 1.1, name: 'B' },
    { id: 'b1', effect: 'base', value: 5, name: 'C' },
    { id: 'b2', effect: 'bonus', value: 3, name: 'D' },
  ];
  const r = applyChip({}, chips);
  const finalScore = Math.floor(100 * r.multBonus + r.scoreBonus);
  assert.equal(finalScore, 129, `mult=${r.multBonus} bonus=${r.scoreBonus}`);
});

// ── formatChipDisplay ───────────────────────────────────────────────────────────
test('formatChipDisplay 空数组返回空串', () => {
  assert.equal(formatChipDisplay([]), '');
  assert.equal(formatChipDisplay(null), '');
});

test('formatChipDisplay mult 格式正确', () => {
  const chips = [{ id: 'c1', name: '连击大师', effect: 'mult', value: 1.1 }];
  const s = formatChipDisplay(chips);
  assert.ok(s.includes('连击大师'));
  assert.ok(s.includes('×1.1'));
});

test('formatChipDisplay 多个 chip 用 · 分隔', () => {
  const chips = [
    { id: 'c1', name: 'A', effect: 'mult', value: 1.2 },
    { id: 'c2', name: 'B', effect: 'base', value: 5 },
  ];
  const s = formatChipDisplay(chips);
  const parts = s.split(' · ');
  assert.equal(parts.length, 2);
});

// ── 重放一致性：mulberry32 驱动，同 seed 在同游戏中产生相同 chip 序列 ───────────
test('重放一致性：同 seed 串跑 10 次，chips 完全相同', () => {
  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(JSON.stringify(rollChips('replay-seed-xyz', 'guandan')));
  }
  assert.ok(results.every(r => r === results[0]), '10 次结果应完全相同');
});
