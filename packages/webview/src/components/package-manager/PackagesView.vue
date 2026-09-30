<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import FeedFilter from "#webview/components/package-manager/FeedFilter.vue";
import PackageDetails from "#webview/components/package-manager/PackageDetails.vue";
import OperationSummary from "#webview/components/package-manager/OperationSummary.vue";
import PackageSection from "#webview/components/package-manager/PackageSection.vue";
import TargetSelect from "#webview/components/package-manager/TargetSelect.vue";
import VscodeSplitPane from "#webview/components/vscode/VscodeSplitPane.vue";
import { sortPackages, type PackageSortMode } from "#webview/lib/packageSort";
import {
  filterPackagesForTarget,
  normalizeFeedFilter,
  queryFeeds,
  latestPackageVersion,
  isPrereleaseVersion,
} from "#manager";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const props = defineProps<{
  sortMode: PackageSortMode;
}>();

const store = usePackageManagerStore();
const { model, selectedTargetValue } = storeToRefs(store);

const view = ref<"installed" | "discover">("installed");
const installedSearch = ref("");
const selectedKeys = ref<string[]>([]);
const selected = computed(() => store.currentPackage);
const selectedVersion = computed(
  () =>
    store.selectedVersion ||
    selected.value?.installedVersion ||
    latestPackageVersion(selected.value) ||
    "",
);
const normalizedSearch = computed(() =>
  installedSearch.value.trim().toLowerCase(),
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
  model.value.availablePackages.filter(
    (item) =>
      model.value.includePrerelease ||
      !item.availableVersion ||
      !isPrereleaseVersion(item.availableVersion),
  ),
);

function onSearchInput(event: Event): void {
  const query = (event.target as HTMLInputElement).value;
  if (view.value === "installed") installedSearch.value = query;
  else store.setSearch(query);
}

const updateIds = computed(
  () =>
    new Set(
      store.visibleUpdates.map((candidate) =>
        candidate.packageId.toLowerCase(),
      ),
    ),
);
const updatePackages = computed(() =>
  installedPackages.value.filter((item) =>
    updateIds.value.has(item.name.toLowerCase()),
  ),
);
const visibleCandidates = computed(() =>
  store.executableUpdates.filter((candidate) =>
    updatePackages.value.some(
      (item) => item.name.toLowerCase() === candidate.packageId.toLowerCase(),
    ),
  ),
);
const eligibleIds = computed(() =>
  updatePackages.value
    .filter((item) =>
      visibleCandidates.value.some(
        (candidate) =>
          candidate.packageId.toLowerCase() === item.name.toLowerCase(),
      ),
    )
    .map((item) => item.id),
);
const effectiveKeys = computed(() =>
  visibleCandidates.value
    .filter((candidate) => selectedKeys.value.includes(candidate.key))
    .map((candidate) => candidate.key),
);
const checkedIds = computed(() =>
  updatePackages.value
    .filter((item) => {
      const candidates = visibleCandidates.value.filter(
        (candidate) =>
          candidate.packageId.toLowerCase() === item.name.toLowerCase(),
      );
      return (
        candidates.length > 0 &&
        candidates.every((candidate) =>
          effectiveKeys.value.includes(candidate.key),
        )
      );
    })
    .map((item) => item.id),
);
const allChecked = computed(
  () =>
    eligibleIds.value.length > 0 &&
    checkedIds.value.length === eligibleIds.value.length,
);
const partial = computed(
  () => effectiveKeys.value.length > 0 && !allChecked.value,
);
const feedFilter = computed(() =>
  normalizeFeedFilter(
    model.value.feedFilter,
    model.value.feeds,
    model.value.selectedFeedId,
  ),
);
const queryingFeeds = computed(() => queryFeeds(model.value));
watch(
  () =>
    JSON.stringify([
      model.value.selectedTargetId,
      feedFilter.value,
      queryingFeeds.value.map((feed) => [feed.id, feed.url]),
      model.value.includePrerelease,
      model.value.updates.context.revision,
    ]),
  () => {
    selectedKeys.value = [];
  },
);
watch(visibleCandidates, (candidates) => {
  const keys = new Set(candidates.map((candidate) => candidate.key));
  selectedKeys.value = selectedKeys.value.filter((key) => keys.has(key));
});
function togglePackage(id: string, checked: boolean): void {
  const item = updatePackages.value.find((item) => item.id === id);
  const keys = visibleCandidates.value
    .filter(
      (candidate) =>
        candidate.packageId.toLowerCase() === item?.name.toLowerCase(),
    )
    .map((candidate) => candidate.key);
  selectedKeys.value = checked
    ? [...new Set([...selectedKeys.value, ...keys])]
    : selectedKeys.value.filter((key) => !keys.includes(key));
}
function toggleAll(event: Event): void {
  selectedKeys.value = (event.target as HTMLInputElement).checked
    ? visibleCandidates.value.map((candidate) => candidate.key)
    : [];
}
function changeView(
  next: "installed" | "discover",
  event?: KeyboardEvent,
): void {
  view.value = next;
  if (event) {
    event.preventDefault();
    (event.currentTarget as HTMLElement).parentElement
      ?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)
      ?.focus();
  }
}
const inventoryLoading = computed(
  () =>
    model.value.installedPackagesStatus === "loading" &&
    installedPackages.value.length === 0,
);
const inventoryFailed = computed(
  () =>
    model.value.installedPackagesStatus === "failed" &&
    installedPackages.value.length === 0,
);
const implicitLoading = computed(
  () =>
    model.value.implicitPackagesStatus === "loading" &&
    implicitPackages.value.length === 0,
);
const implicitFailed = computed(
  () =>
    model.value.implicitPackagesStatus === "failed" &&
    implicitPackages.value.length === 0,
);
const displayedOperations = computed(() => [
  ...model.value.operations.filter((operation) => !operation.outcome),
  ...model.value.operations.filter((operation) => operation.outcome).slice(-3),
]);

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
            :placeholder="
              view === 'installed'
                ? 'Filter installed packages'
                : 'Search packages'
            "
            :aria-label="
              view === 'installed'
                ? 'Filter installed packages'
                : 'Search available packages'
            "
            :value="view === 'installed' ? installedSearch : model.search"
            @input="onSearchInput"
          />
          <TargetSelect />
          <FeedFilter
            :feeds="model.feeds"
            :filter="feedFilter"
            @change="store.setFeedFilter"
            @manage="store.post({ type: 'setActiveTab', tab: 'sources' })"
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
        <div
          role="tablist"
          aria-label="Package lists"
          class="flex shrink-0 gap-1 border-b border-border-muted px-2 pt-2"
        >
          <button
            id="installed-tab"
            type="button"
            role="tab"
            data-view="installed"
            :aria-selected="view === 'installed'"
            aria-controls="installed-panel"
            :tabindex="view === 'installed' ? 0 : -1"
            class="rounded-t px-3 py-1.5"
            :class="
              view === 'installed'
                ? 'bg-surface-1 font-semibold'
                : 'text-fg-muted'
            "
            :aria-label="`Installed, ${updateIds.size} packages with updates`"
            @click="changeView('installed')"
            @keydown.right="changeView('discover', $event)"
            @keydown.left="changeView('discover', $event)"
          >
            Installed <span class="text-xs">{{ updateIds.size }}</span>
          </button>
          <button
            id="discover-tab"
            type="button"
            role="tab"
            data-view="discover"
            :aria-selected="view === 'discover'"
            aria-controls="discover-panel"
            :tabindex="view === 'discover' ? 0 : -1"
            class="rounded-t px-3 py-1.5"
            :class="
              view === 'discover'
                ? 'bg-surface-1 font-semibold'
                : 'text-fg-muted'
            "
            @click="changeView('discover')"
            @keydown.right="changeView('installed', $event)"
            @keydown.left="changeView('installed', $event)"
          >
            Discover
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-2">
          <OperationSummary
            v-for="operation in displayedOperations"
            :key="operation.plan.id"
            :operation="operation"
            @cancel="store.cancelOperation"
            @retry="store.retryOperation"
            @confirm="store.confirmOperation"
          />
          <div
            v-show="view === 'installed'"
            id="installed-panel"
            role="tabpanel"
            aria-labelledby="installed-tab"
            tabindex="0"
          >
            <PackageSection
              title="Packages to Update"
              :packages="updatePackages"
              batch
              :eligible-ids="eligibleIds"
              :selected-ids="checkedIds"
              empty-message="No updates available for this filter."
              @toggle="togglePackage"
            >
              <template #actions>
                <label class="flex items-center gap-1 text-xs"
                  ><input
                    type="checkbox"
                    aria-label="Select all visible eligible updates"
                    :checked="allChecked"
                    :indeterminate="partial"
                    :disabled="!eligibleIds.length"
                    @change="toggleAll"
                  />All</label
                >
                <button
                  type="button"
                  class="rounded bg-button px-2 py-1 text-xs text-button-fg disabled:opacity-50"
                  :disabled="
                    !effectiveKeys.length ||
                    model.operations.some((operation) => !operation.outcome)
                  "
                  @click="
                    store.upgradeCandidates(
                      effectiveKeys,
                      model.updates.context.revision,
                    )
                  "
                >
                  Update ({{ checkedIds.length }})
                </button>
              </template>
            </PackageSection>
            <PackageSection
              title="Installed Packages"
              :packages="installedPackages"
              :loading="inventoryLoading"
              :error="inventoryFailed"
              :empty-message="
                hasSearch
                  ? 'No installed packages match this filter.'
                  : 'No packages installed in this target.'
              "
            />
            <PackageSection
              title="Implicitly Installed Packages"
              :packages="implicitPackages"
              :loading="implicitLoading"
              :error="implicitFailed"
              collapsed
              :empty-message="
                hasSearch
                  ? 'No implicit packages match this filter.'
                  : 'No implicit packages in this target.'
              "
            />
          </div>
          <div
            v-show="view === 'discover'"
            id="discover-panel"
            role="tabpanel"
            aria-labelledby="discover-tab"
            tabindex="0"
          >
            <PackageSection
              :title="
                model.searchResultLimit
                  ? `Available Packages · up to ${model.searchResultLimit}`
                  : 'Available Packages'
              "
              :packages="queryingFeeds.length ? displayedAvailablePackages : []"
              :loading="
                queryingFeeds.length > 0 &&
                model.flows.search.status === 'loading'
              "
              :error="
                queryingFeeds.length > 0 &&
                model.flows.search.status === 'failed'
              "
              :empty-message="
                queryingFeeds.length
                  ? 'No packages match this search.'
                  : 'No feeds selected. Choose a feed to discover packages.'
              "
            />
          </div>
        </div>
      </div>
    </template>

    <template #end>
      <aside class="h-full min-h-0 overflow-auto bg-surface-0">
        <PackageDetails
          v-if="selected"
          :key="`${selected.id}:${selectedVersion}`"
          :package-item="selected"
          @search="
            (query) => {
              view = 'discover';
              store.setSearch(query);
            }
          "
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
