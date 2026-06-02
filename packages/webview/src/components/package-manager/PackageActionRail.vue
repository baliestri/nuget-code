<script setup lang="ts">
import { computed, ref } from "vue";
import VscodeIcon from "#webview/components/vscode/VscodeIcon.vue";
import type { PackageSortMode } from "#webview/lib/packageSort";

interface PackageActionRailItem {
  id: string;
  icon: string;
  label: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  run: () => void;
}

const props = withDefaults(
  defineProps<{
    actions: PackageActionRailItem[];
    sortMode?: PackageSortMode | undefined;
    showSort?: boolean;
  }>(),
  {
    sortMode: "smart",
    showSort: false,
  },
);

const emit = defineEmits<{
  "sort-change": [mode: PackageSortMode];
}>();

const sortOpen = ref(false);
const primaryActions = computed(() =>
  props.actions.filter((action) => !action.separatorBefore),
);
const secondaryActions = computed(() =>
  props.actions.filter((action) => action.separatorBefore),
);

function handleFocusOut(event: FocusEvent): void {
  const current = event.currentTarget;
  const next = event.relatedTarget;
  if (
    current instanceof HTMLElement &&
    next instanceof Node &&
    current.contains(next)
  ) {
    return;
  }
  sortOpen.value = false;
}

function setSortMode(mode: PackageSortMode): void {
  sortOpen.value = false;
  emit("sort-change", mode);
}
</script>

<template>
  <nav
    class="flex h-full w-9 shrink-0 flex-col items-center gap-1 border-r border-border-muted bg-surface-1 px-1 py-1"
    aria-label="Package manager actions"
  >
    <template v-for="action in primaryActions" :key="action.id">
      <button
        class="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg focus:outline focus:outline-1 focus:outline-focus disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :title="action.label"
        :aria-label="action.label"
        :disabled="action.disabled"
        @click="action.run"
      >
        <VscodeIcon :icon="action.icon" />
      </button>
    </template>

    <div
      v-if="showSort"
      class="relative"
      @focusout="handleFocusOut"
      @keydown.escape="sortOpen = false"
    >
      <button
        class="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg focus:outline focus:outline-1 focus:outline-focus"
        type="button"
        title="Sort installed and transitive packages"
        aria-label="Sort installed and transitive packages"
        aria-haspopup="menu"
        :aria-expanded="sortOpen"
        @click="sortOpen = !sortOpen"
      >
        <VscodeIcon
          :icon="sortMode === 'smart' ? 'list-selection' : 'sort-precedence'"
        />
      </button>
      <div
        v-if="sortOpen"
        class="absolute left-full top-0 z-30 ml-1 min-w-36 rounded border border-dropdown-border bg-dropdown p-1 text-sm text-dropdown-fg shadow-lg"
        role="menu"
      >
        <button
          class="grid w-full grid-cols-[1rem_1fr] items-center gap-2 rounded px-2 py-1 text-left hover:bg-list-hover hover:text-list-hover-fg"
          type="button"
          role="menuitemradio"
          :aria-checked="sortMode === 'smart'"
          @click="setSortMode('smart')"
        >
          <VscodeIcon v-if="sortMode === 'smart'" icon="check" />
          <span v-else />
          <span>Smart</span>
        </button>
        <button
          class="grid w-full grid-cols-[1rem_1fr] items-center gap-2 rounded px-2 py-1 text-left hover:bg-list-hover hover:text-list-hover-fg"
          type="button"
          role="menuitemradio"
          :aria-checked="sortMode === 'alphabetical'"
          @click="setSortMode('alphabetical')"
        >
          <VscodeIcon v-if="sortMode === 'alphabetical'" icon="check" />
          <span v-else />
          <span>Alphabetical</span>
        </button>
      </div>
    </div>

    <template v-for="action in secondaryActions" :key="action.id">
      <div class="my-1 h-px w-5 bg-border-muted" />
      <button
        class="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg focus:outline focus:outline-1 focus:outline-focus disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        :title="action.label"
        :aria-label="action.label"
        :disabled="action.disabled"
        @click="action.run"
      >
        <VscodeIcon :icon="action.icon" />
      </button>
    </template>
  </nav>
</template>
