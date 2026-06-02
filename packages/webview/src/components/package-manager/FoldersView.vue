<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { NuGetCacheFolder } from "#contracts";
import { formatBytes, formatDate } from "#webview/lib/format";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const store = usePackageManagerStore();
const { model } = storeToRefs(store);

function folderTitle(folder: NuGetCacheFolder): string {
  return folder.sizeCalculatedAt
    ? `Last calculated at ${formatDate(folder.sizeCalculatedAt)}`
    : "";
}
</script>

<template>
  <div class="h-full overflow-auto">
    <table class="w-full border-collapse text-sm">
      <thead class="sticky top-0 bg-surface-1 text-left">
        <tr>
          <th class="border-b border-border-muted px-2 py-1">Title</th>
          <th class="border-b border-border-muted px-2 py-1">Path</th>
          <th class="border-b border-border-muted px-2 py-1 text-right">
            Size
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="folder in model.folders"
          :key="folder.id"
          :class="
            folder.selected
              ? 'bg-list-active text-list-active-fg'
              : 'hover:bg-list-hover'
          "
          @click="store.toggleFolder(folder.id)"
        >
          <td class="border-b border-border-muted px-2 py-1">
            {{ folder.title }}
          </td>
          <td class="border-b border-border-muted px-2 py-1 text-fg-muted">
            {{ folder.path }}
          </td>
          <td
            class="border-b border-border-muted px-2 py-1 text-right"
            :title="folderTitle(folder)"
          >
            {{ formatBytes(folder.sizeBytes) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
