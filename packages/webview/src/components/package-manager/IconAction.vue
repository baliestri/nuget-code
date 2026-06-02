<script setup lang="ts">
import { computed } from "vue";
import VscodeIcon from "#webview/components/vscode/VscodeIcon.vue";

const props = defineProps<{
  icon: string;
  label: string;
  tone: "add" | "update" | "remove";
  disabled: boolean;
}>();

const emit = defineEmits<{
  run: [];
}>();

const toneClass = computed(
  () =>
    ({
      add: "text-success hover:bg-success/10",
      update: "text-warning hover:bg-warning/10",
      remove: "text-error hover:bg-error/10",
    })[props.tone],
);

function run(event: MouseEvent): void {
  event.stopPropagation();
  emit("run");
}
</script>

<template>
  <button
    :class="`inline-flex h-7 w-7 items-center justify-center rounded border border-transparent ${toneClass} disabled:cursor-not-allowed disabled:opacity-40`"
    type="button"
    :title="label"
    :aria-label="label"
    :disabled="disabled"
    @click="run"
  >
    <VscodeIcon :icon="icon" />
  </button>
</template>
