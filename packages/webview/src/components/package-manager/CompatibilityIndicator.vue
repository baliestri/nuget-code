<script setup lang="ts">
import { computed, ref, useId, nextTick } from "vue";
import type { UpgradeCandidate } from "#contracts";
import VscodeIcon from "#webview/components/vscode/VscodeIcon.vue";

const props = defineProps<{ candidates: readonly UpgradeCandidate[] }>();
const tooltipId = useId();
const open = ref(false);
const anchor = ref<HTMLElement>();
const tooltip = ref<HTMLElement>();
const position = ref({ left: "0px", top: "0px" });
async function show(): Promise<void> {
  open.value = true;
  await nextTick();
  const bounds = anchor.value?.getBoundingClientRect();
  const content = tooltip.value?.getBoundingClientRect();
  if (!bounds || !content) return;
  const left = Math.max(
    8,
    Math.min(
      bounds.right - content.width,
      window.innerWidth - content.width - 8,
    ),
  );
  const top =
    bounds.bottom + content.height + 8 <= window.innerHeight
      ? bounds.bottom + 4
      : Math.max(8, bounds.top - content.height - 4);
  position.value = { left: `${left}px`, top: `${top}px` };
}
const reasons: Record<string, string> = {
  "incomplete-catalog": "Package source data is incomplete.",
  "reference-scope-unknown":
    "The projects affected by this reference could not be determined.",
  "project-context-unverified":
    "The project configuration could not be reproduced for verification.",
  "snapshot-changed": "The project changed since verification started.",
  "restore-interrupted": "Package restore was interrupted.",
  "restore-incomplete": "Package restore did not produce complete results.",
  "restore-failed": "Package restore did not complete successfully.",
  "resolved-version-mismatch": "Restore resolved a different package version.",
  "frameworks-incomplete": "Not all target frameworks could be verified.",
  "assets-or-source-unverified":
    "The restored package or its source could not be verified.",
  "source-overrides-unverified":
    "Project source overrides could not be verified.",
  "package-build-import":
    "Package build imports are not supported by isolated verification.",
  "package-manifest-incomplete":
    "The package manifest could not be fully verified.",
  "missing-project-mapping":
    "The project could not be mapped to the verification copy.",
  "empty-scope": "No projects were available for verification.",
  "cleanup-failed": "The verification workspace could not be cleaned up.",
  cancelled: "Verification was cancelled.",
  timeout: "Verification timed out.",
};
const pending = (candidate: UpgradeCandidate) =>
  candidate.compatibility.status === "unverified" &&
  candidate.compatibility.reason === "compatibility-not-verified";
const status = computed(() => {
  if (
    props.candidates.every(
      (candidate) => candidate.compatibility.status === "compatible",
    )
  )
    return {
      icon: "check",
      label: "Update compatibility verified",
      checking: false,
    };
  if (
    props.candidates.every(
      (candidate) =>
        candidate.compatibility.status === "compatible" || pending(candidate),
    )
  )
    return {
      icon: "sync",
      label: "Checking update compatibility",
      checking: true,
    };
  return {
    icon: "question",
    label: "Update compatibility not verified",
    checking: false,
  };
});
const explanation = computed(() =>
  props.candidates
    .map((candidate) => {
      const result = candidate.compatibility;
      const reason =
        result.status === "compatible"
          ? "Compatibility verified. Eligible for Update All."
          : pending(candidate)
            ? "Verification is pending or in progress. Excluded from Update All until verified."
            : `${result.status === "unverified" ? (reasons[result.reason] ?? "No applicable compatibility verification is available for this project.") : "This update is incompatible with the project."} Excluded from Update All.`;
      return `${candidate.projectPath} — ${candidate.version}\n${reason}${result.status === "unverified" && !pending(candidate) ? " Select a version in package details to update explicitly and let NuGet restore validate it. See Log for project evaluation details." : ""}`;
    })
    .join("\n\n"),
);
</script>

<template>
  <span
    ref="anchor"
    class="relative inline-flex text-fg-muted"
    @mouseenter="show"
    @mouseleave="open = false"
  >
    <span
      tabindex="0"
      role="img"
      :aria-label="status.label"
      :aria-describedby="tooltipId"
      class="inline-flex rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus"
      @focus="show"
      @blur="open = false"
      @keydown.esc.stop="open = false"
    >
      <VscodeIcon
        :icon="status.icon"
        :class="{ 'animate-spin motion-reduce:animate-none': status.checking }"
      />
    </span>
    <span
      v-show="open"
      :id="tooltipId"
      ref="tooltip"
      :style="position"
      role="tooltip"
      class="fixed z-50 w-72 max-h-[80vh] max-w-[80vw] overflow-auto whitespace-pre-line break-words rounded border border-border-muted bg-surface-1 p-2 text-left text-xs text-fg shadow-lg"
    >
      <strong class="mb-1 block">{{ status.label }}</strong>
      <span>{{ explanation }}</span>
    </span>
  </span>
</template>
