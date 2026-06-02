<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import FoldersView from "#webview/components/package-manager/FoldersView.vue";
import LogsView from "#webview/components/package-manager/LogsView.vue";
import PackageActionRail from "#webview/components/package-manager/PackageActionRail.vue";
import PackagesView from "#webview/components/package-manager/PackagesView.vue";
import SourcesView from "#webview/components/package-manager/SourcesView.vue";
import { readString, writeString } from "#webview/composables/useLocalStorage";
import {
  packageSortModes,
  type PackageSortMode,
} from "#webview/lib/packageSort";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const store = usePackageManagerStore();
const { model } = storeToRefs(store);

interface PackageActionRailItem {
  id: string;
  icon: string;
  label: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  run: () => void;
}

const packageSortMode = ref<PackageSortMode>(
  readString("nuget.packages.sortMode", "smart", packageSortModes),
);
let disconnect: (() => void) | undefined;

const hasSelectedFolder = computed(() =>
  model.value.folders.some((folder) => folder.selected),
);
const railActions = computed<PackageActionRailItem[]>(() => {
  const restore: PackageActionRailItem = {
    id: "restore",
    icon: "cloud-download",
    label: "Restore packages",
    run: () => store.runCommand("restore"),
  };
  const settings: PackageActionRailItem = {
    id: "openSettings",
    icon: "gear",
    label: "Open extension settings",
    separatorBefore: true,
    run: () => store.runCommand("openSettings"),
  };

  switch (model.value.activeTab) {
    case "packages":
      return [
        restore,
        {
          id: "refreshPackages",
          icon: "refresh",
          label: "Refresh packages from all feeds",
          run: () => store.runCommand("refreshPackages", { feedId: "__all__" }),
        },
        {
          id: "upgradePackages",
          icon: "arrow-up",
          label: "Upgrade packages in selected context",
          disabled: !model.value.hasUpgrades,
          run: () => store.runCommand("upgradePackages"),
        },
        settings,
      ];
    case "sources":
      return [
        restore,
        {
          id: "reloadSources",
          icon: "server-process",
          label: "Reload NuGet sources",
          run: () => store.runCommand("reloadSources"),
        },
        settings,
      ];
    case "folders":
      return [
        restore,
        {
          id: "recalculateCacheSizes",
          icon: "dashboard",
          label: "Recalculate folder sizes",
          run: () => store.runCommand("recalculateCacheSizes"),
        },
        {
          id: "openCacheFolder",
          icon: "folder-opened",
          label: "Open selected cache folder",
          disabled: !hasSelectedFolder.value,
          run: () => store.runCommand("openCacheFolder"),
        },
        {
          id: "clearSelectedCaches",
          icon: "trash",
          label: "Clear selected cache folders",
          disabled: !hasSelectedFolder.value,
          run: () => store.runCommand("clearSelectedCaches"),
        },
        settings,
      ];
    case "logs":
      return [
        restore,
        {
          id: "refreshLogs",
          icon: "refresh",
          label: "Refresh logs",
          run: () => store.runCommand("refreshLogs"),
        },
        settings,
      ];
  }

  return [];
});

onMounted(() => {
  disconnect = store.connect();
});

onUnmounted(() => {
  disconnect?.();
});

function setPackageSortMode(mode: PackageSortMode): void {
  packageSortMode.value = mode;
  writeString("nuget.packages.sortMode", mode);
}
</script>

<template>
  <main class="flex h-screen min-h-0 flex-col bg-app text-fg">
    <section class="flex min-h-0 flex-1 overflow-hidden">
      <PackageActionRail
        :actions="railActions"
        :show-sort="model.activeTab === 'packages'"
        :sort-mode="packageSortMode"
        @sort-change="setPackageSortMode"
      />
      <div class="min-w-0 flex-1 overflow-hidden">
        <PackagesView
          v-if="model.activeTab === 'packages'"
          :sort-mode="packageSortMode"
        />
        <SourcesView v-else-if="model.activeTab === 'sources'" />
        <FoldersView v-else-if="model.activeTab === 'folders'" />
        <LogsView v-else />
      </div>
    </section>
  </main>
</template>
