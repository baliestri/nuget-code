<script setup lang="ts">
import type { NuGetPackageItem } from "#contracts";
import PackageRow from "#webview/components/package-manager/PackageRow.vue";

withDefaults(
  defineProps<{
    title: string;
    packages: NuGetPackageItem[];
    loading?: boolean;
    error?: boolean;
  }>(),
  {
    loading: false,
    error: false,
  },
);
</script>

<template>
  <section class="border-b border-border-muted">
    <h2
      class="sticky top-0 z-10 bg-surface-1 px-3 py-2 text-sm font-semibold text-fg"
    >
      {{ title }}
    </h2>
    <div>
      <div
        v-if="loading"
        class="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-1.5"
        aria-busy="true"
      >
        <span class="flex min-w-0 items-center gap-2">
          <span class="h-4 w-4 shrink-0 rounded bg-surface-2" />
          <span class="h-4 w-40 max-w-full rounded bg-surface-2" />
        </span>
        <span class="h-4 w-16 rounded bg-surface-2" />
      </div>
      <div v-else-if="error" class="px-3 py-3 text-sm text-error">
        Failed to load packages. Check the Logs tab for details.
      </div>
      <div
        v-else-if="packages.length === 0"
        class="px-3 py-3 text-sm text-fg-muted"
      >
        No packages.
      </div>
      <PackageRow
        v-for="packageItem in packages"
        v-else
        :key="packageItem.id"
        :package-item="packageItem"
      />
    </div>
  </section>
</template>
