<script setup>
import { computed } from 'vue';
const props = defineProps({
  card: Object,   // {s, v, id}
  mini: Boolean,
  selected: Boolean,
  wild: Boolean,  // 逢人配高亮
});
const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANKS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const isJ = computed(() => props.card?.s === 'J');
const rank = computed(() => (isJ.value ? (props.card.v === 'B' ? '大王' : '小王') : RANKS[props.card?.v] || ''));
const sym = computed(() => SUITS[props.card?.s] || '');
const cls = computed(() => ({
  pcard: true,
  red: !isJ.value && (props.card?.s === 'H' || props.card?.s === 'D'),
  black: !isJ.value && (props.card?.s === 'S' || props.card?.s === 'C'),
  jB: isJ.value && props.card?.v === 'B',
  jS: isJ.value && props.card?.v === 'S',
  mini: props.mini,
  sel: props.selected,
}));
</script>

<template>
  <div v-if="card" :class="cls" :data-id="card.id">
    <div class="tl"><span class="rk">{{ rank }}</span><span class="st">{{ isJ ? '★' : sym }}</span></div>
    <div class="big" v-if="!mini">{{ isJ ? (card.v === 'B' ? '★' : '☆') : sym }}</div>
    <div class="br"><span class="rk">{{ rank }}</span><span class="st">{{ isJ ? '★' : sym }}</span></div>
    <span v-if="wild" class="wild-badge">配</span>
  </div>
</template>

<style scoped>
.pcard.jB .rk, .pcard.jB .st, .pcard.jB .big { color: var(--red); }
.pcard.jS .rk, .pcard.jS .st, .pcard.jS .big { color: #3a6ea5; }
</style>
