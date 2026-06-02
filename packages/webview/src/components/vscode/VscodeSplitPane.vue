<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    storageKey?: string;
    initial?: number;
  }>(),
  {
    storageKey: "",
    initial: 52,
  },
);

const root = ref<HTMLElement>();
const firstPanePercent = ref(52);
const dragging = ref(false);

const gridStyle = computed(
  () =>
    `grid-template-columns: minmax(260px, ${firstPanePercent.value}%) 4px minmax(280px, 1fr);`,
);

onMounted(() => {
  const stored = props.storageKey
    ? window.localStorage.getItem(props.storageKey)
    : null;
  const parsed = stored ? Number(stored) : props.initial;
  firstPanePercent.value = clamp(
    Number.isFinite(parsed) ? parsed : props.initial,
  );
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopDragging);
});

onUnmounted(() => {
  window.removeEventListener("pointermove", handlePointerMove);
  window.removeEventListener("pointerup", stopDragging);
});

function startDragging(event: PointerEvent): void {
  dragging.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}

function handlePointerMove(event: PointerEvent): void {
  if (!dragging.value || !root.value) {
    return;
  }
  const rect = root.value.getBoundingClientRect();
  const percent = ((event.clientX - rect.left) / rect.width) * 100;
  firstPanePercent.value = clamp(percent);
  if (props.storageKey) {
    window.localStorage.setItem(
      props.storageKey,
      String(firstPanePercent.value),
    );
  }
}

function stopDragging(): void {
  dragging.value = false;
}

function clamp(value: number): number {
  return Math.min(75, Math.max(28, value));
}
</script>

<template>
  <section ref="root" class="grid h-full min-h-0" :style="gridStyle">
    <slot name="start" />
    <div
      :class="[
        'bg-border-default cursor-col-resize touch-none hover:bg-focus',
        dragging ? 'bg-focus' : '',
      ]"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startDragging"
    />
    <slot name="end" />
  </section>
</template>
