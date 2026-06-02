<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import VscodeIcon from "#webview/components/vscode/VscodeIcon.vue";

export interface MultiSelectOption {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    options: MultiSelectOption[];
    selected: string[];
    label?: string;
    selectionMode?: "multi" | "minimum";
  }>(),
  {
    label: "Options",
    selectionMode: "multi",
  },
);

const emit = defineEmits<{
  "selection-change": [value: string[]];
}>();

const root = ref<HTMLElement>();
const open = ref(false);
const selectedSet = computed(() => new Set(props.selected));
const selectedLabel = computed(() => {
  if (props.selectionMode === "minimum") {
    return `${props.label}: ${getMinimumLabel()}`;
  }

  return props.selected.length === props.options.length
    ? `All ${props.label.toLowerCase()}`
    : `${props.selected.length} selected`;
});

onMounted(() => {
  window.addEventListener("pointerdown", closeOnOutsidePointerDown);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
});

function toggleOption(value: string): void {
  if (props.selectionMode === "minimum") {
    const index = props.options.findIndex((option) => option.value === value);
    const next =
      index < 0
        ? props.selected
        : props.options.slice(index).map((option) => option.value);
    emit("selection-change", next);
    return;
  }

  const nextSelected = new Set(props.selected);
  if (nextSelected.has(value)) {
    nextSelected.delete(value);
  } else {
    nextSelected.add(value);
  }

  const next = props.options
    .map((option) => option.value)
    .filter((optionValue) => nextSelected.has(optionValue));
  emit("selection-change", next);
}

function getMinimumLabel(): string {
  return (
    props.options.find((option) => selectedSet.value.has(option.value))
      ?.label ?? "None"
  );
}

function closeOnOutsidePointerDown(event: PointerEvent): void {
  if (!open.value || root.value?.contains(event.target as Node | null)) {
    return;
  }
  open.value = false;
}
</script>

<template>
  <div ref="root" class="relative inline-block text-sm">
    <button
      class="inline-flex min-w-24 items-center justify-between gap-0.5 rounded border border-dropdown-border bg-dropdown px-1 py-1 text-dropdown-fg hover:bg-surface-hover focus:outline focus:outline-1 focus:outline-focus"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :title="label"
      type="button"
      @click="open = !open"
    >
      <span>{{ selectedLabel }}</span>
      <VscodeIcon icon="chevron-down" />
    </button>
    <div
      v-if="open"
      class="absolute right-0 z-20 mt-1 min-w-44 rounded border border-dropdown-border bg-dropdown p-1 text-dropdown-fg shadow-lg"
      role="listbox"
      :aria-label="label"
    >
      <button
        v-for="option in options"
        :key="option.value"
        class="grid w-full grid-cols-[1rem_1fr] items-center gap-2 rounded px-2 py-1 text-left hover:bg-list-hover hover:text-list-hover-fg"
        role="option"
        :aria-selected="selectedSet.has(option.value)"
        type="button"
        @click="toggleOption(option.value)"
      >
        <span class="inline-flex h-4 w-4 items-center justify-center">
          <VscodeIcon v-if="selectedSet.has(option.value)" icon="check" />
        </span>
        <span>{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>
