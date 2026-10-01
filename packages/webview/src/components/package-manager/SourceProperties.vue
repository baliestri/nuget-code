<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  NuGetConfigFile,
  SourcePropertiesEdit,
  SourceEditRequest,
} from "#contracts";
type EditContext = Omit<SourceEditRequest, "edit" | "requestId">;
const props = defineProps<{
  source?: NuGetConfigFile | undefined;
  effectiveSource?: NuGetConfigFile | undefined;
  destination?: NuGetConfigFile | undefined;
  context: EditContext | null;
  disabled: boolean;
}>();
const emit = defineEmits<{
  save: [edit: SourcePropertiesEdit, context: EditContext | null];
}>();
const capturedContext = props.context ? { ...props.context } : null;
const globalPackagesFolder = ref("");
const repositoryPath = ref("");
const effectiveFolders = computed(
  () =>
    props.effectiveSource?.packageFolders ?? props.source?.packageFolders ?? [],
);
function effectiveFolder(key: "globalPackagesFolder" | "repositoryPath") {
  const values = [
    ...new Set(
      effectiveFolders.value.map((folder) => folder[key]).filter(Boolean),
    ),
  ];
  return values.length === 1
    ? values[0]
    : values.length > 1
      ? "Varies by project"
      : "";
}
watch(
  () => props.destination?.id,
  () => {
    globalPackagesFolder.value =
      props.destination?.properties?.globalPackagesFolder ?? "";
    repositoryPath.value = props.destination?.properties?.repositoryPath ?? "";
  },
  { immediate: true },
);
</script>

<template>
  <form
    class="grid gap-4"
    @submit.prevent="
      emit(
        'save',
        { action: 'properties', globalPackagesFolder, repositoryPath },
        capturedContext,
      )
    "
  >
    <fieldset :disabled="disabled" class="grid min-w-0 gap-4">
      <label
        class="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center"
      >
        Global packages folder
        <div class="min-w-0">
          <input
            v-model="globalPackagesFolder"
            aria-label="Global packages folder"
            placeholder="Inherited or default"
            class="w-full min-w-0 rounded border border-input-border bg-input px-2 py-1 text-input-fg"
          />
          <span class="mt-1 block break-all text-fg-muted">{{
            effectiveFolder("globalPackagesFolder")
          }}</span>
        </div>
      </label>
      <label
        class="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center"
      >
        Local packages folder
        <div class="min-w-0">
          <input
            v-model="repositoryPath"
            aria-label="Local packages folder"
            title="Applies to packages.config projects. Leave empty to inherit."
            placeholder="Inherited or solution packages folder"
            class="w-full min-w-0 rounded border border-input-border bg-input px-2 py-1 text-input-fg"
          />
          <span class="mt-1 block break-all text-fg-muted">{{
            effectiveFolder("repositoryPath")
          }}</span>
        </div>
      </label>
      <div>
        <button
          type="submit"
          class="rounded bg-button px-3 py-1 text-button-fg"
        >
          Save properties
        </button>
      </div>
    </fieldset>
  </form>
</template>
