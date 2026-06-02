<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { NuGetPackageItem } from "#contracts";
import FeedBadges from "#webview/components/package-manager/FeedBadges.vue";
import PackageIcon from "#webview/components/package-manager/PackageIcon.vue";
import { upgradablePackageVersion } from "#manager";
import { rowClass } from "#webview/lib/ui";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const props = defineProps<{
  packageItem: NuGetPackageItem;
}>();

const store = usePackageManagerStore();
const { model, selectedPackageId } = storeToRefs(store);
const selected = computed(
  () =>
    props.packageItem.id ===
    (selectedPackageId.value ?? model.value.selectedPackageId),
);
const installed = computed(() => props.packageItem.installedVersion ?? "");
const available = computed(() =>
  installed.value
    ? upgradablePackageVersion(props.packageItem)
    : props.packageItem.availableVersion,
);
</script>

<template>
  <button
    :class="
      rowClass(
        selected,
        'grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-1.5 text-left',
      )
    "
    type="button"
    @click="store.selectPackageItem(packageItem)"
  >
    <span class="flex min-w-0 items-center gap-2">
      <PackageIcon :package-item="packageItem" size-class="h-4 w-4" />
      <span class="truncate font-medium">{{ packageItem.name }}</span>
      <template v-if="installed">
        <span class="shrink-0 text-fg-muted">·</span>
        <span class="shrink-0 text-fg-muted">{{ installed }}</span>
      </template>
      <FeedBadges :package-item="packageItem" />
    </span>
    <span class="shrink-0 text-sm text-list-highlight">
      {{ available ?? "" }}
    </span>
  </button>
</template>
