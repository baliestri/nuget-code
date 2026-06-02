<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { NuGetConfigFile, PackageFeed } from "#contracts";
import VscodeSplitPane from "#webview/components/vscode/VscodeSplitPane.vue";
import { selectedSource } from "#manager";
import { rowClass } from "#webview/lib/ui";
import { yesNo } from "#webview/lib/format";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const store = usePackageManagerStore();
const { model } = storeToRefs(store);
const source = computed(() => selectedSource(model.value));

function sourceRowClass(item: NuGetConfigFile): string {
  return rowClass(
    item.id === model.value.selectedSourceId,
    "block w-full px-3 py-2 text-left",
  );
}

function feedKey(feed: PackageFeed): string {
  return `${feed.name}:${feed.url}`;
}
</script>

<template>
  <VscodeSplitPane
    class="block h-full min-h-0"
    storage-key="nuget.sourcesSplit"
    :initial="38"
  >
    <template #start>
      <div class="h-full overflow-auto border-r border-border-muted">
        <button
          v-for="item in model.sources"
          :key="item.id"
          :class="sourceRowClass(item)"
          type="button"
          @click="store.selectSourceId(item.id)"
        >
          <div class="truncate font-medium">{{ item.name }}</div>
          <div class="truncate text-xs text-fg-muted">{{ item.scope }}</div>
        </button>
      </div>
    </template>

    <template #end>
      <div class="h-full overflow-auto p-3">
        <h2 class="mb-3 text-sm font-semibold">
          {{ source?.name ?? "No source selected" }}
        </h2>
        <table v-if="source" class="w-full border-collapse text-sm">
          <thead class="sticky top-0 bg-surface-1 text-left">
            <tr>
              <th class="border-b border-border-muted px-2 py-1">Name</th>
              <th class="border-b border-border-muted px-2 py-1">Url</th>
              <th class="border-b border-border-muted px-2 py-1">Enabled</th>
              <th class="border-b border-border-muted px-2 py-1">
                Allow insecure
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="feed in source.feeds"
              :key="feedKey(feed)"
              class="hover:bg-list-hover"
            >
              <td class="border-b border-border-muted px-2 py-1">
                {{ feed.name }}
              </td>
              <td class="border-b border-border-muted px-2 py-1 text-fg-muted">
                {{ feed.url }}
              </td>
              <td class="border-b border-border-muted px-2 py-1">
                {{ yesNo(feed.enabled) }}
              </td>
              <td class="border-b border-border-muted px-2 py-1">
                {{ yesNo(Boolean(feed.allowInsecure)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </VscodeSplitPane>
</template>
