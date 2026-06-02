<script setup lang="ts">
import { computed } from "vue";
import type { PackageFeed } from "#contracts";

const props = withDefaults(
  defineProps<{
    feeds: PackageFeed[];
    selectedFeedId: string;
    includeAllFeeds?: boolean;
  }>(),
  {
    includeAllFeeds: true,
  },
);

const emit = defineEmits<{
  change: [feedId: string];
}>();

const options = computed(() =>
  props.includeAllFeeds
    ? props.feeds
    : props.feeds.filter((feed) => feed.id !== "__all__"),
);

function onChange(event: Event): void {
  emit("change", (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <select
    class="min-w-44 flex-1 rounded border border-dropdown-border bg-dropdown px-2 py-1 text-dropdown-fg"
    :value="selectedFeedId"
    @change="onChange"
  >
    <option v-for="feed in options" :key="feed.id" :value="feed.id">
      {{ feed.name }}
    </option>
  </select>
</template>
