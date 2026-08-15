<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import FeedSelect from "#webview/components/package-manager/FeedSelect.vue";
import PackageDetails from "#webview/components/package-manager/PackageDetails.vue";
import PackageSection from "#webview/components/package-manager/PackageSection.vue";
import TargetSelect from "#webview/components/package-manager/TargetSelect.vue";
import VscodeSplitPane from "#webview/components/vscode/VscodeSplitPane.vue";
import { sortPackages, type PackageSortMode } from "#webview/lib/packageSort";
import {
  filterPackagesForTarget,
  latestPackageVersion,
  selectedPackage,
} from "#manager";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const props = defineProps<{
  sortMode: PackageSortMode;
}>();

const store = usePackageManagerStore();
const { model, selectedPackageId, selectedTargetValue } = storeToRefs(store);

const selected = computed(() =>
  selectedPackage(
    model.value,
    selectedPackageId.value ?? model.value.selectedPackageId,
  ),
);
const selectedVersion = computed(
  () =>
    store.selectedVersion ||
    selected.value?.installedVersion ||
    latestPackageVersion(selected.value) ||
    "",
);
const normalizedSearch = computed(() =>
  model.value.search.trim().toLowerCase(),
);
const hasSearch = computed(() => normalizedSearch.value.length > 0);
const targetInstalledPackages = computed(() =>
  filterPackagesForTarget(
    model.value.installedPackages,
    selectedTargetValue.value,
  ),
);
const targetImplicitPackages = computed(() =>
  filterPackagesForTarget(
    model.value.implicitPackages,
    selectedTargetValue.value,
  ),
);
const installedPackages = computed(() =>
  sortPackages(
    hasSearch.value
      ? targetInstalledPackages.value.filter((packageItem) =>
          packageItem.name.toLowerCase().includes(normalizedSearch.value),
        )
      : targetInstalledPackages.value,
    props.sortMode,
  ),
);
const implicitPackages = computed(() =>
  sortPackages(
    hasSearch.value
      ? targetImplicitPackages.value.filter((packageItem) =>
          packageItem.name.toLowerCase().includes(normalizedSearch.value),
        )
      : targetImplicitPackages.value,
    props.sortMode,
  ),
);
const displayedAvailablePackages = computed(() =>
  model.value.availablePackages.slice(0, 100),
);

function onSearchInput(event: Event): void {
  store.setSearch((event.target as HTMLInputElement).value);
}

function onPrereleaseChange(event: Event): void {
  store.setIncludePrerelease((event.target as HTMLInputElement).checked);
}
</script>

<template>
  <VscodeSplitPane
    class="block h-full min-h-0"
    storage-key="nuget.packagesSplit"
    :initial="50"
  >
    <template #start>
      <div class="flex h-full min-h-0 flex-col">
        <div
          class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-muted p-1"
        >
          <input
            class="min-w-44 flex-1 rounded border border-input-border bg-input px-2 py-1 text-input-fg placeholder:text-input-placeholder"
            type="search"
            placeholder="Search packages"
            :value="model.search"
            @input="onSearchInput"
          />
          <TargetSelect />
          <FeedSelect
            :feeds="model.feeds"
            :selected-feed-id="model.selectedFeedId"
            @change="store.selectFeedId"
          />
          <label class="flex items-center gap-1 text-sm text-fg-muted">
            <input
              type="checkbox"
              :checked="model.includePrerelease"
              @change="onPrereleaseChange"
            />
            Prerelease
          </label>
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <PackageSection
            v-if="model.installedPackagesStatus === 'loading'"
            :title="`Installed Packages in ${selectedTargetValue?.name ?? 'workspace'}`"
            :packages="[]"
            loading
          />
          <PackageSection
            v-else-if="model.installedPackagesStatus === 'failed'"
            :title="`Installed Packages in ${selectedTargetValue?.name ?? 'workspace'}`"
            :packages="[]"
            error
          />
          <PackageSection
            v-else-if="installedPackages.length > 0"
            :title="`Installed Packages in ${selectedTargetValue?.name ?? 'workspace'}: ${installedPackages.length}`"
            :packages="installedPackages"
          />
          <PackageSection
            v-if="model.implicitPackagesStatus === 'loading'"
            :title="`Implicitly Installed Packages in ${selectedTargetValue?.name ?? 'workspace'}`"
            :packages="[]"
            loading
          />
          <PackageSection
            v-else-if="model.implicitPackagesStatus === 'failed'"
            :title="`Implicitly Installed Packages in ${selectedTargetValue?.name ?? 'workspace'}`"
            :packages="[]"
            error
          />
          <PackageSection
            v-else-if="implicitPackages.length > 0"
            :title="`Implicitly Installed Packages in ${selectedTargetValue?.name ?? 'workspace'}: ${implicitPackages.length}`"
            :packages="implicitPackages"
          />
          <PackageSection
            :title="`Available Packages: Top ${displayedAvailablePackages.length}`"
            :packages="displayedAvailablePackages"
          />
        </div>
      </div>
    </template>

    <template #end>
      <aside class="h-full min-h-0 overflow-auto bg-surface-0">
        <PackageDetails
          v-if="selected"
          :key="`${selected.id}:${selectedVersion}`"
          :package-item="selected"
        />
        <div
          v-else
          class="flex h-full items-center justify-center p-6 text-center text-fg-muted"
        >
          Select a package to see details.
        </div>
      </aside>
    </template>
  </VscodeSplitPane>
</template>
