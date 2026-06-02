<!-- eslint-disable vue/no-v-html -->
<script setup lang="ts">
import { computed } from "vue";
import slnIcon from "#webview/assets/icons/sln.svg?raw";
import csprojIcon from "#webview/assets/icons/csproj.svg?raw";
import fsprojIcon from "#webview/assets/icons/fsproj.svg?raw";
import vbprojIcon from "#webview/assets/icons/vbproj.svg?raw";

const props = withDefaults(
  defineProps<{
    icon?: string;
  }>(),
  {
    icon: "circle-filled",
  },
);

const customIcons = {
  sln: slnIcon,
  csproj: csprojIcon,
  fsproj: fsprojIcon,
  vbproj: vbprojIcon,
} as const;

const customSvg = computed(() =>
  props.icon in customIcons
    ? customIcons[props.icon as keyof typeof customIcons]
    : undefined,
);
</script>

<template>
  <span
    v-if="customSvg"
    aria-hidden="true"
    class="inline-flex h-4 w-4 items-center justify-center align-middle leading-none text-current [&>svg]:h-4 [&>svg]:w-4"
    v-html="customSvg"
  />
  <span
    v-else
    aria-hidden="true"
    :class="`codicon codicon-${icon} inline-flex h-4 w-4 items-center justify-center align-middle text-base leading-none`"
  />
</template>
