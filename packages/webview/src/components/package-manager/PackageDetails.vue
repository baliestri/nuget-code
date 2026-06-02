<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { NuGetPackageDependencyGroup, NuGetPackageItem } from "#contracts";
import FeedSelect from "#webview/components/package-manager/FeedSelect.vue";
import IconAction from "#webview/components/package-manager/IconAction.vue";
import PackageIcon from "#webview/components/package-manager/PackageIcon.vue";
import ProjectRow from "#webview/components/package-manager/ProjectRow.vue";
import { feedName, packageVersions, selectedTarget } from "#manager";
import { splitAuthors } from "#webview/lib/ui";
import { formatDate } from "#webview/lib/format";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const props = defineProps<{
  packageItem: NuGetPackageItem;
}>();

const store = usePackageManagerStore();
const { model, selectedVersion, selectedDetailFeedId } = storeToRefs(store);
const selectedProjectPaths = computed(() =>
  store.selectedProjectPathsForTarget(),
);
const selectedVersionInfo = computed(() =>
  props.packageItem.versions.find(
    (version) => version.version === selectedVersion.value,
  ),
);
const globalActions = computed(() =>
  store.getGlobalProjectActions(
    props.packageItem,
    selectedVersion.value,
    selectedProjectPaths.value,
  ),
);
const target = computed(() => selectedTarget(model.value));
const projectPaths = computed(() => target.value?.projectPaths ?? []);
const authorLinks = computed(() => splitAuthors(props.packageItem.authors));

function setSearch(query: string): void {
  store.setSearch(query);
}

function onVersionChange(event: Event): void {
  store.setSelectedVersion((event.target as HTMLSelectElement).value);
}

function runGlobalAdd(): void {
  store.runPackageCommandForProjects(
    "addPackage",
    selectedVersion.value,
    selectedDetailFeedId.value,
    globalActions.value.add,
  );
}

function runGlobalUpdate(): void {
  store.runPackageCommandForProjects(
    "upgradeSelectedPackage",
    selectedVersion.value,
    selectedDetailFeedId.value,
    globalActions.value.update,
  );
}

function runGlobalDowngrade(): void {
  store.runPackageCommandForProjects(
    "upgradeSelectedPackage",
    selectedVersion.value,
    selectedDetailFeedId.value,
    globalActions.value.downgrade,
  );
}

function runGlobalRemove(): void {
  store.runPackageCommandForProjects(
    "removePackage",
    selectedVersion.value,
    selectedDetailFeedId.value,
    globalActions.value.remove,
  );
}

function dependencyKey(group: NuGetPackageDependencyGroup): string {
  return `${group.framework}:${group.dependencies.length}`;
}
</script>

<template>
  <div class="flex min-h-full flex-col gap-4 p-4">
    <div
      v-if="packageItem.deprecated"
      class="rounded border border-warning bg-surface-2 p-3 text-warning"
    >
      Deprecated{{
        packageItem.alternatePackage
          ? `: use ${packageItem.alternatePackage}`
          : ""
      }}
    </div>

    <header class="flex items-center gap-3 border-b border-border-muted pb-3">
      <PackageIcon :package-item="packageItem" size-class="h-8 w-8" />
      <div class="min-w-0">
        <h1 class="truncate text-lg font-semibold">{{ packageItem.name }}</h1>
        <p class="truncate text-sm text-fg-muted">
          {{ feedName(selectedDetailFeedId, model) }}
        </p>
      </div>
    </header>

    <div
      class="flex flex-wrap items-center gap-2 border-b border-border-muted pb-3"
    >
      <select
        class="min-w-36 flex-1 rounded border border-dropdown-border bg-dropdown px-2 py-1 text-dropdown-fg"
        :value="selectedVersion"
        @change="onVersionChange"
      >
        <option
          v-for="version in packageVersions(packageItem)"
          :key="version"
          :value="version"
        >
          {{ version }}
        </option>
      </select>
      <FeedSelect
        :feeds="model.feeds"
        :selected-feed-id="selectedDetailFeedId"
        :include-all-feeds="false"
        @change="store.setSelectedDetailFeed"
      />
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <IconAction
          icon="add"
          label="Add to selected projects"
          tone="add"
          :disabled="globalActions.add.length === 0"
          @run="runGlobalAdd"
        />
        <IconAction
          icon="arrow-up"
          label="Update selected projects"
          tone="update"
          :disabled="globalActions.update.length === 0"
          @run="runGlobalUpdate"
        />
        <IconAction
          icon="arrow-down"
          label="Downgrade selected projects"
          tone="update"
          :disabled="globalActions.downgrade.length === 0"
          @run="runGlobalDowngrade"
        />
        <IconAction
          icon="trash"
          label="Remove from selected projects"
          tone="remove"
          :disabled="globalActions.remove.length === 0"
          @run="runGlobalRemove"
        />
      </div>
    </div>

    <section
      class="min-h-0 overflow-hidden rounded border border-border-muted bg-surface-1"
    >
      <header
        class="border-b border-border-muted px-3 py-2 text-sm font-semibold"
      >
        Projects
      </header>
      <div
        v-if="projectPaths.length === 0"
        class="px-3 py-3 text-sm text-fg-muted"
      >
        No projects were found for the selected target.
      </div>
      <div v-else class="max-h-56 overflow-auto">
        <ProjectRow
          v-for="projectPath in projectPaths"
          :key="projectPath"
          :package-item="packageItem"
          :project-path="projectPath"
          :selected-version="selectedVersion"
        />
      </div>
    </section>

    <details class="rounded border border-border-muted bg-surface-1" open>
      <summary class="cursor-pointer px-3 py-2 font-semibold">
        Package information
      </summary>
      <dl class="grid gap-2 p-3 text-sm">
        <div class="grid grid-cols-[120px_1fr] gap-3">
          <dt class="text-fg-muted">Description</dt>
          <dd class="min-w-0 break-words">
            {{ packageItem.description || "None" }}
          </dd>
        </div>
        <div class="grid grid-cols-[120px_1fr] gap-3">
          <dt class="text-fg-muted">Authors</dt>
          <dd class="min-w-0 break-words">
            <template v-if="authorLinks.length === 0">None</template>
            <template v-else>
              <template v-for="(author, index) in authorLinks" :key="author">
                <span v-if="index > 0">, </span>
                <button
                  class="text-list-highlight hover:underline"
                  type="button"
                  @click="setSearch(`author:${author}`)"
                >
                  {{ author }}
                </button>
              </template>
            </template>
          </dd>
        </div>
        <div class="grid grid-cols-[120px_1fr] gap-3">
          <dt class="text-fg-muted">Tags</dt>
          <dd class="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
            <template v-if="!packageItem.tags || packageItem.tags.length === 0">
              None
            </template>
            <button
              v-for="tag in packageItem.tags ?? []"
              v-else
              :key="tag"
              class="text-list-highlight hover:underline"
              type="button"
              @click="setSearch(`tags:${tag}`)"
            >
              {{ tag }}
            </button>
          </dd>
        </div>
        <div class="grid grid-cols-[120px_1fr] gap-3">
          <dt class="text-fg-muted">Published</dt>
          <dd class="min-w-0 break-words">
            {{
              formatDate(
                selectedVersionInfo?.published ?? packageItem.published,
              ) || "None"
            }}
          </dd>
        </div>
      </dl>
    </details>

    <details class="rounded border border-border-muted bg-surface-1">
      <summary class="cursor-pointer px-3 py-2 font-semibold">
        Dependencies
      </summary>
      <div class="grid gap-3 p-3 text-sm">
        <div
          v-if="packageItem.dependencyGroups.length === 0"
          class="text-fg-muted"
        >
          None
        </div>
        <section
          v-for="group in packageItem.dependencyGroups"
          v-else
          :key="dependencyKey(group)"
        >
          <h3 class="mb-1 font-semibold">{{ group.framework || "None" }}</h3>
          <div v-if="group.dependencies.length === 0" class="text-fg-muted">
            None
          </div>
          <ul v-else class="grid gap-1">
            <li
              v-for="dependency in group.dependencies"
              :key="`${dependency.id}:${dependency.versionRange}`"
              class="flex justify-between gap-3"
            >
              <span>{{ dependency.id }}</span>
              <span class="text-fg-muted">{{ dependency.versionRange }}</span>
            </li>
          </ul>
        </section>
      </div>
    </details>
  </div>
</template>
