<script setup>
import { computed } from 'vue';
const props = defineProps({
  m: Object,      // match（reactive）
  seat: Number,
  active: Boolean,
  trick: Array,   // [{seat, act:{kind,cards,combo}|{kind:'pass'}}]
  names: Object,
  isHuman: Boolean,
});
const count = computed(() => props.m.hands[props.seat].length);
const done = computed(() => props.m.finishedOrder.includes(props.seat));
const last = computed(() => props.trick.find(t => t.seat === props.seat)?.act || null);
const team = computed(() => props.seat % 2 === 0 ? 0 : 1);
const sub = computed(() => {
  if (last.value?.kind === 'play') return '· 出 ' + last.value.cards.length + ' 张';
  if (last.value?.kind === 'pass') return '· 过';
  return '';
});
</script>

<template>
  <div class="seat" :class="{ active, done }">
    <div class="avatar">{{ isHuman ? '你' : 'AI' }}</div>
    <div class="meta">
      <span class="name">{{ names[seat] }}</span>
      <span class="sub">{{ team === 0 ? '自家' : '对家' }}{{ sub }}</span>
    </div>
    <div class="cardbacks" v-if="!isHuman && !done"><div class="bk" v-for="i in Math.min(count, 4)" :key="i"></div></div>
    <div class="cnt"><span :class="{ done }">{{ done ? '出完' : count }}</span><em>{{ done ? '' : '张' }}</em></div>
  </div>
</template>
