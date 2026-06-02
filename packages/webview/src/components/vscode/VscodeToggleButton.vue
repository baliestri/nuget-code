<script setup lang="ts">
import VscodeButton from "#webview/components/vscode/VscodeButton.vue";

const props = withDefaults(
  defineProps<{
    active?: boolean;
    disabled?: boolean;
    icon?: string | undefined;
    label?: string;
  }>(),
  {
    active: false,
    disabled: false,
    label: "",
  },
);

const emit = defineEmits<{
  "toggle-change": [value: boolean];
}>();

function emitToggle(): void {
  if (props.disabled) {
    return;
  }
  emit("toggle-change", !props.active);
}
</script>

<template>
  <VscodeButton
    variant="ghost"
    :icon="icon"
    :label="label"
    :active="active"
    :disabled="disabled"
    @click="emitToggle"
  >
    <slot />
  </VscodeButton>
</template>
