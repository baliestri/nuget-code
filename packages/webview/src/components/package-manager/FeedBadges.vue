<script setup lang="ts">
import type { NuGetPackageItem, PackageFeedSummary } from "#contracts";

defineProps<{
  packageItem: NuGetPackageItem;
}>();

function feedTitle(feed: PackageFeedSummary): string {
  return feed.name;
}
</script>

<template>
  <span class="flex min-w-0 flex-wrap items-center gap-1">
    <span
      v-for="feed in packageItem.availableFeeds ?? []"
      :key="feed.id"
      class="max-w-28 truncate rounded py-0.5 text-xs"
      :style="{ color: feed.color }"
      :title="feedTitle(feed)"
    >
      {{ feed.displayName }}
    </span>
  </span>
</template>
