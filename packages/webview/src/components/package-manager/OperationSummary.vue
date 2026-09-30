<script setup lang="ts">
import { computed } from "vue";
import type { MutationOperation, MutationStep } from "#contracts";
const props = defineProps<{ operation: MutationOperation }>();
defineEmits<{
  cancel: [id: string];
  retry: [id: string];
  confirm: [id: string, revision: string, accepted: boolean];
}>();
const active = computed(() => !props.operation.outcome);
const title = computed(() =>
  props.operation.status === "awaiting-confirmation"
    ? "Package plan changed"
    : `Package operation · ${props.operation.status}`,
);
const canRetry = computed(
  () =>
    !!props.operation.outcome &&
    (!!props.operation.outcome.reconciliationError ||
      props.operation.outcome.steps.some(
        (step) => step.status !== "completed",
      )),
);
const results = computed(
  () =>
    new Map(
      (props.operation.outcome?.steps ?? props.operation.progress ?? []).map(
        (step) => [step.stepId, step],
      ),
    ),
);
function label(step: MutationStep): string {
  return `${step.action} ${step.packageId || (step.kind === "clear-cache" ? "NuGet caches" : "project")}${step.version ? ` → ${step.version}` : ""}`;
}
function status(id: string): string {
  const result = results.value.get(id);
  if (
    props.operation.outcome ||
    result?.status === "completed" ||
    result?.status === "failed"
  )
    return result?.status ?? "not-executed";
  return props.operation.activeStepId === id &&
    props.operation.status === "running"
    ? "running"
    : "pending";
}
</script>
<template>
  <section
    class="border-b border-border-muted px-3 py-2 text-xs"
    aria-label="Package operation"
  >
    <header class="flex flex-wrap items-center gap-2" aria-live="polite">
      <strong class="font-semibold">{{ title }}</strong>
      <button
        v-if="active && operation.status !== 'reconciling'"
        type="button"
        class="ml-auto rounded px-1 text-list-highlight focus:outline focus:outline-1 focus:outline-focus disabled:opacity-50"
        :disabled="operation.cancelRequested"
        @click="$emit('cancel', operation.plan.id)"
      >
        Cancel
      </button>
      <button
        v-if="canRetry"
        type="button"
        class="ml-auto rounded px-1 text-list-highlight focus:outline focus:outline-1 focus:outline-focus"
        @click="$emit('retry', operation.plan.id)"
      >
        Recalculate remaining
      </button>
    </header>
    <p
      v-if="operation.cancelRequested && active"
      role="status"
      class="mt-1 text-fg-muted"
    >
      Cancellation requested. Waiting for the current command and
      reconciliation.
    </p>
    <ul class="mt-1 space-y-1">
      <li v-for="step in operation.plan.steps" :key="step.id">
        <span>{{ label(step) }}</span>
        <span class="ml-2 text-fg-muted">{{ status(step.id) }}</span>
        <div class="break-all text-fg-muted">
          {{ (step.cachePaths || step.projectPaths).join(", ") }}
        </div>
        <div
          v-if="
            operation.status === 'awaiting-confirmation' && step.feedUrls.length
          "
          class="break-all text-fg-muted"
        >
          Sources: {{ step.feedUrls.join(", ") }}
        </div>
        <p v-if="results.get(step.id)?.error" role="alert" class="text-warning">
          {{ results.get(step.id)?.error }}
        </p>
        <ul v-if="results.get(step.id)?.projects" class="pl-2 text-fg-muted">
          <li
            v-for="project in results.get(step.id)?.projects"
            :key="project.projectPath"
            class="break-all"
          >
            {{ project.projectPath }} · {{ project.status }}
          </li>
        </ul>
        <p
          v-if="results.get(step.id)?.changedPaths.length"
          class="break-all text-fg-muted"
        >
          Changed documents:
          {{ results.get(step.id)?.changedPaths.join(", ") }}. No rollback was
          performed.
        </p>
      </li>
    </ul>
    <p
      v-if="operation.outcome?.reconciliationError"
      role="alert"
      class="mt-1 text-warning"
    >
      Commands finished, but inventory could not be reconciled:
      {{ operation.outcome.reconciliationError }}
    </p>
    <div
      v-if="operation.status === 'awaiting-confirmation'"
      class="mt-2 flex flex-wrap gap-2"
    >
      <button
        type="button"
        class="rounded border border-input-border bg-input px-2 py-1 focus:outline focus:outline-1 focus:outline-focus"
        @click="
          $emit(
            'confirm',
            operation.plan.id,
            operation.plan.contextRevision,
            true,
          )
        "
      >
        Apply this plan
      </button>
      <button
        type="button"
        class="rounded border border-input-border px-2 py-1 focus:outline focus:outline-1 focus:outline-focus"
        @click="
          $emit(
            'confirm',
            operation.plan.id,
            operation.plan.contextRevision,
            false,
          )
        "
      >
        Keep current files
      </button>
    </div>
  </section>
</template>
