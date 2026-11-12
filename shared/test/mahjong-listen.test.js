import { test } from 'node:test';
import assert from 'node:assert';
import {
  createSession, startSessionHand, autoPlayHand, gameover, waits, listenForAll
} from '../src/cards/mahjong.js';

// v1.37 麻将 各家听口数（掼蛋"报牌"等价：谁在听、听几张）：listenForAll 的不变量

test('listenForAll：13 张座计数=waits 门数、tenpai=有听座；14 张座（摸牌后）计 0', () => {
  for (const seed of [42, 8, 123]) {
    const g = startSessionHand(createSession(seed, 0, 4));
    if (gameover(g)) continue; // 天胡终局跳过
    const lf = listenForAll(g);
    for (let s = 0; s < 4; s++) {
      if (g.hands[s].length === 13) {
        assert.equal(lf.counts[s], waits(g.hands[s]).length, `seed=${seed} 座${s} 听口数=waits 门数`);
      } else {
        assert.equal(lf.counts[s], 0, `seed=${seed} 座${s} 14 张(摸牌中)计 0`);
      }
    }
    // tenpai = 所有 13 张且 has-wait 的座
    const expectTenpai = [0, 1, 2, 3].filter((s) => g.hands[s].length === 13 && waits(g.hands[s]).length > 0);
    assert.deepEqual(lf.tenpai, expectTenpai, `seed=${seed} tenpai 集`);
  }
});

test('listenForAll：终局（over）→ 计数全 0 + tenpai 空', () => {
  const se = createSession(7, 0, 4);
  const g = startSessionHand(se);
  autoPlayHand(g);
  assert.ok(gameover(g), 'autoPlayHand 后本局终局');
  const lf = listenForAll(g);
  assert.deepEqual(lf.counts, [0, 0, 0, 0]);
  assert.deepEqual(lf.tenpai, []);
});
