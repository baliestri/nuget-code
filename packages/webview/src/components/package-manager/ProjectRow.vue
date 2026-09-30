<script setup lang="ts">
import csprojIcon from "#webview/assets/icons/csproj.svg";
import fsprojIcon from "#webview/assets/icons/fsproj.svg";
import vbprojIcon from "#webview/assets/icons/vbproj.svg";
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { NuGetPackageItem } from "#contracts";
import IconAction from "#webview/components/package-manager/IconAction.vue";
import {
  detailFeedId,
  packageProjectState,
  projectName,
  projectVersionAction,
} from "#manager";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const props = defineProps<{
  packageItem: NuGetPackageItem;
  projectPath: string;
  selectedVersion: string;
}>();

const projectIcon = computed(() =>
  props.projectPath.endsWith(".fsproj")
    ? fsprojIcon
    : props.projectPath.endsWith(".vbproj")
      ? vbprojIcon
      : csprojIcon,
);
const store = usePackageManagerStore();
const { model, selectedDetailFeedId, selectedProjectPaths } =
  storeToRefs(store);
const projectState = computed(() =>
  packageProjectState(props.packageItem, props.projectPath),
);
const installedVersion = computed(() => projectState.value?.installedVersion);
const frameworkVersions = computed(() =>
  model.value.installedReferences
    .filter(
      (reference) =>
        reference.packageId.toLowerCase() ===
          props.packageItem.name.toLowerCase() &&
        reference.projectPath === props.projectPath,
    )
    .map(
      (reference) =>
        `${reference.framework}: ${reference.resolvedVersion ?? "unresolved"}`,
    ),
);
const installed = computed(() => Boolean(installedVersion.value));
const checked = computed(() =>
  selectedProjectPaths.value.includes(props.projectPath),
);
const action = computed(() =>
  projectVersionAction(installedVersion.value, props.selectedVersion),
);
const versionActionIcon = computed(() =>
  action.value === "update"
    ? "arrow-up"
    : action.value === "downgrade"
      ? "arrow-down"
      : "add",
);
const versionActionLabel = computed(() =>
  action.value === "update"
    ? "Update package"
    : action.value === "downgrade"
      ? "Downgrade package"
      : "Add package",
);
const actionTone = computed(() =>
  action.value === "downgrade" ? "update" : action.value,
);
const commandFeedId = computed(
  () =>
    selectedDetailFeedId.value || detailFeedId(props.packageItem, model.value),
);

function runVersionAction(): void {
  store.runPackageCommandForProjects(
    action.value === "update" || action.value === "downgrade"
      ? "upgradeSelectedPackage"
      : "addPackage",
    props.selectedVersion,
    commandFeedId.value,
    [props.projectPath],
  );
}

function runRemove(): void {
  store.runPackageCommandForProjects(
    "removePackage",
    props.selectedVersion,
    commandFeedId.value,
    [props.projectPath],
  );
}

function onProjectChecked(event: Event): void {
  store.setProjectSelected(
    props.projectPath,
    (event.target as HTMLInputElement).checked,
  );
}
</script>

<template>
  <div
    class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 border-b border-border-muted px-3 py-1.5 text-sm last:border-b-0 hover:bg-list-hover hover:text-list-hover-fg"
  >
    <input
      type="checkbox"
      :aria-label="`Select ${projectName(projectPath)}`"
      :checked="checked"
      @change="onProjectChecked"
    />
    <span class="flex min-w-0 items-center gap-2" :title="projectPath">
      <img :src="projectIcon" alt="" class="h-4 w-4 shrink-0" /><span
        class="truncate"
      >
        {{ projectName(projectPath) }}</span
      >
    </span>
    <span class="shrink-0 text-fg-muted">
      {{
        frameworkVersions.length > 1
          ? frameworkVersions.join(" · ")
          : installed
            ? (installedVersion ?? "installed")
            : "-"
      }}
    </span>
    <span class="flex items-center justify-end gap-1">
      <IconAction
        v-if="action !== 'remove'"
        :icon="versionActionIcon"
        :label="versionActionLabel"
        :tone="actionTone"
        :disabled="!selectedVersion || store.isPackageBusy(packageItem.name)"
        @run="runVersionAction"
      />
      <IconAction
        v-if="installed"
        icon="trash"
        label="Remove package"
        tone="remove"
        :disabled="store.isPackageBusy(packageItem.name)"
        @run="runRemove"
      />
    </span>
  </div>
</template>
