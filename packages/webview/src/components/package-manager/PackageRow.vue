<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { NuGetPackageItem } from "#contracts";
import FeedBadges from "#webview/components/package-manager/FeedBadges.vue";
import PackageIcon from "#webview/components/package-manager/PackageIcon.vue";
import CompatibilityIndicator from "#webview/components/package-manager/CompatibilityIndicator.vue";
import { rowClass } from "#webview/lib/ui";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const props = defineProps<{
  packageItem: NuGetPackageItem;
  batch?: boolean;
  checked?: boolean;
  eligible?: boolean;
}>();

const emit = defineEmits<{ toggle: [checked: boolean] }>();
const store = usePackageManagerStore();
const { model, selectedPackageId } = storeToRefs(store);
const selected = computed(
  () =>
    props.packageItem.id ===
    (selectedPackageId.value ?? model.value.selectedPackageId),
);
const installed = computed(
  () =>
    [
      ...new Set(
        (props.packageItem.projectStates ?? [])
          .map((state) => state.installedVersion)
          .filter(Boolean),
      ),
    ].join(" / ") ||
    props.packageItem.installedVersion ||
    "",
);
const updates = computed(() =>
  store.visibleUpdates.filter(
    (candidate) =>
      candidate.packageId.toLowerCase() ===
      props.packageItem.name.toLowerCase(),
  ),
);
const available = computed(() =>
  [...new Set(updates.value.map((candidate) => candidate.version))].map(
    (version) => ({
      version,
      candidates: updates.value.filter(
        (candidate) => candidate.version === version,
      ),
    }),
  ),
);
</script>

<template>
  <div
    :class="
      rowClass(selected, 'flex w-full items-center gap-2 px-3 py-1.5 text-left')
    "
  >
    <input
      v-if="batch"
      type="checkbox"
      :checked="checked"
      :disabled="!eligible"
      :aria-label="`Select update for ${packageItem.name}`"
      :title="
        eligible
          ? 'Include this package in selected updates'
          : 'Compatibility must be verified before selecting this update'
      "
      @change="emit('toggle', ($event.target as HTMLInputElement).checked)"
    />
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 text-left"
      :title="packageItem.name"
      :aria-pressed="selected"
      @click="store.selectPackageItem(packageItem)"
    >
      <PackageIcon :package-item="packageItem" size-class="h-4 w-4" />
      <span class="truncate font-medium">{{ packageItem.name }}</span>
      <template v-if="installed">
        <span class="shrink-0 text-fg-muted">·</span>
        <span class="shrink-0 text-fg-muted">{{ installed }}</span>
      </template>
      <FeedBadges :package-item="packageItem" />
    </button>
    <span class="flex shrink-0 items-center gap-2 text-sm text-list-highlight">
      <template v-if="installed">
        <span
          v-for="update in available"
          :key="update.version"
          class="inline-flex items-center gap-1"
        >
          <button type="button" @click="store.selectPackageItem(packageItem)">
            {{ update.version }}
          </button>
          <CompatibilityIndicator :candidates="update.candidates" />
        </span>
      </template>
      <button
        v-else-if="packageItem.availableVersion"
        type="button"
        @click="store.selectPackageItem(packageItem)"
      >
        {{ packageItem.availableVersion ?? "" }}
      </button>
    </span>
  </div>
</template>
