<script setup lang="ts">
import type { LoadState } from "#contracts";
defineProps<{ state: LoadState; label: string }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div
    v-if="
      state.status === 'loading' || state.status === 'failed' || state.stale
    "
    class="flex flex-wrap items-center gap-2 border-b border-border-muted px-3 py-1 text-xs text-fg-muted"
    :role="state.status === 'failed' ? 'alert' : 'status'"
    aria-live="polite"
  >
    <span v-if="state.status === 'loading'">Loading {{ label }}…</span>
    <span v-else-if="state.status === 'failed'">{{
      state.error || `Could not load ${label}.`
    }}</span>
    <span v-if="state.stale">Showing previous data.</span>
    <button
      v-if="state.status !== 'loading'"
      type="button"
      class="rounded px-1 text-list-highlight hover:underline focus:outline focus:outline-1 focus:outline-focus"
      @click="$emit('retry')"
    >
      Retry
    </button>
  </div>
</template>
