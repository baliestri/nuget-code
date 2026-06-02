<script setup lang="ts">
import { computed } from "vue";
import VscodeIcon from "#webview/components/vscode/VscodeIcon.vue";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    disabled?: boolean;
    icon?: string | undefined;
    label?: string;
    active?: boolean;
  }>(),
  {
    variant: "primary",
    disabled: false,
    label: "",
    active: false,
  },
);

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-accent-fg hover:bg-accent-hover focus:outline focus:outline-1 focus:outline-focus disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center gap-1.5 rounded bg-accent-secondary px-3 py-1.5 text-accent-secondary-fg hover:bg-accent-secondary-hover disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center gap-0.5 rounded border border-transparent px-1 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "inline-flex items-center gap-1.5 rounded border border-error px-3 py-1.5 text-error hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50",
};

const buttonClass = computed(() => {
  const activeStyles = props.active
    ? "bg-input-option-active text-input-option-active-fg border-input-option-active-border"
    : "";
  return `${variantStyles[props.variant]} ${activeStyles}`;
});
</script>

<template>
  <button
    :class="buttonClass"
    :disabled="disabled"
    :aria-label="label || undefined"
    :title="label || undefined"
    type="button"
  >
    <VscodeIcon
      v-if="icon"
      class="inline-flex h-4 w-4 items-center justify-center leading-none"
      :icon="icon"
    />
    <span :class="label && icon ? 'sr-only' : ''">
      <slot>{{ label }}</slot>
    </span>
  </button>
</template>
