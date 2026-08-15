<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import VscodeIcon from "#webview/components/vscode/VscodeIcon.vue";
import { filterTargetsForActiveSolution, targetIcon } from "#manager";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const store = usePackageManagerStore();
const { model, selectedTargetValue } = storeToRefs(store);
const open = ref(false);
const visibleTargets = computed(() =>
  filterTargetsForActiveSolution(
    model.value.targets,
    model.value.selectedTargetId,
  ),
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
  open.value = false;
}
</script>

<template>
  <div
    class="relative"
    @focusout="handleFocusOut"
    @keydown.escape="open = false"
  >
    <button
      class="flex min-w-36 items-center justify-between gap-2 rounded border border-dropdown-border bg-dropdown px-2 py-1 text-left text-dropdown-fg"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="truncate">{{ selectedTargetValue?.name ?? "..." }}</span>
      <VscodeIcon icon="chevron-down" />
    </button>
    <div
      v-if="open"
      class="absolute left-0 top-full z-20 mt-1 max-h-64 min-w-full overflow-auto rounded border border-dropdown-border bg-dropdown py-1 text-dropdown-fg shadow-lg"
      role="listbox"
    >
      <button
        v-for="target in visibleTargets"
        :key="target.id"
        :class="`flex w-full items-center gap-2 px-2 py-1 text-left ${target.id === model.selectedTargetId ? 'bg-list-active text-list-active-fg' : 'hover:bg-list-hover hover:text-list-hover-fg'}`"
        type="button"
        role="option"
        :aria-selected="target.id === model.selectedTargetId"
        @click="
          open = false;
          store.selectTargetId(target.id);
        "
      >
        <VscodeIcon v-if="targetIcon(target)" :icon="targetIcon(target)!" />
        <span v-else class="h-4 w-4 shrink-0" />
        <span class="truncate">{{ target.name }}</span>
      </button>
    </div>
  </div>
</template>
