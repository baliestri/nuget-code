<script setup lang="ts">
import { ref } from "vue";
import type { NuGetPackageItem } from "#contracts";
import PackageRow from "#webview/components/package-manager/PackageRow.vue";
const props = withDefaults(
  defineProps<{
    title: string;
    packages: NuGetPackageItem[];
    loading?: boolean;
    error?: boolean;
    collapsed?: boolean;
    emptyMessage?: string;
    batch?: boolean;
    eligibleIds?: string[];
    selectedIds?: string[];
  }>(),
  {
    loading: false,
    error: false,
    collapsed: false,
    emptyMessage: "No packages.",
    batch: false,
    eligibleIds: () => [],
    selectedIds: () => [],
  },
);
const emit = defineEmits<{ toggle: [id: string, checked: boolean] }>();
const expanded = ref(!props.collapsed);
</script>
<template>
  <section class="mb-2 rounded border border-border-muted bg-surface-1">
    <header class="flex flex-wrap items-center gap-2 px-2 py-1.5">
      <h2 class="min-w-0 flex-1 text-sm font-semibold">
        <button
          type="button"
          class="flex w-full items-center gap-2 text-left"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <span aria-hidden="true">{{ expanded ? "▾" : "▸" }}</span
          >{{ title
          }}<span class="text-xs font-normal text-fg-muted">{{
            packages.length
          }}</span>
        </button>
      </h2>
      <slot name="actions" />
    </header>
    <div v-show="expanded">
      <p
        v-if="loading && !packages.length"
        class="px-3 py-3 text-sm text-fg-muted"
        aria-busy="true"
      >
        Loading packages…
      </p>
      <p
        v-else-if="error && !packages.length"
        class="px-3 py-3 text-sm text-error"
      >
        Failed to load packages. Check the Logs tab for details.
      </p>
      <p v-else-if="!packages.length" class="px-3 py-3 text-sm text-fg-muted">
        {{ emptyMessage }}
      </p>
      <PackageRow
        v-for="item in packages"
        :key="item.id"
        :package-item="item"
        :batch="batch"
        :eligible="eligibleIds.includes(item.id)"
        :checked="selectedIds.includes(item.id)"
        @toggle="emit('toggle', item.id, $event)"
      />
    </div>
  </section>
</template>
