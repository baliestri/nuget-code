<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { NuGetPackageItem } from "#contracts";
import packageIconSvg from "#webview/assets/icons/package.svg?raw";

const props = defineProps<{
  packageItem: NuGetPackageItem;
  sizeClass: string;
}>();

const packageFallbackIcon = `data:image/svg+xml,${encodeURIComponent(
  packageIconSvg,
)}`;
const source = ref(props.packageItem.iconUrl || packageFallbackIcon);

watch(
  () => props.packageItem.iconUrl,
  (iconUrl) => {
    source.value = iconUrl || packageFallbackIcon;
  },
);

const imageClass = computed(
  () => `${props.sizeClass} shrink-0 rounded object-contain`,
);

function usePackageFallbackIcon(): void {
  if (source.value !== packageFallbackIcon) {
    source.value = packageFallbackIcon;
  }
}
</script>

<template>
  <img
    :class="imageClass"
    :src="source"
    alt=""
    aria-hidden="true"
    @error="usePackageFallbackIcon"
  />
</template>
