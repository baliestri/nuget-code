<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { PackageFeed, SourceEdit, SourceEditRequest } from "#contracts";
import VscodeSplitPane from "#webview/components/vscode/VscodeSplitPane.vue";
import VscodeIcon from "#webview/components/vscode/VscodeIcon.vue";
import SourceProperties from "./SourceProperties.vue";
import SourceSummary from "./SourceSummary.vue";
import { selectedSource } from "#manager";
import { rowClass } from "#webview/lib/ui";
import { usePackageManagerStore } from "#webview/stores/packageManager";
const store = usePackageManagerStore();
const { model } = storeToRefs(store);
const source = computed(() => selectedSource(model.value));
const destinationId = computed(
  () =>
    model.value.sourceEditor?.destinations.find((item) => item.suggested)?.id ??
    "",
);
const tabs = ["Feeds", "Properties", "Summary"] as const;
const tab = ref<(typeof tabs)[number]>("Feeds");
function moveTab(event: KeyboardEvent, index: number) {
  event.preventDefault();
  tab.value = tabs[(index + tabs.length) % tabs.length]!;
  (event.currentTarget as HTMLElement).parentElement
    ?.querySelector<HTMLButtonElement>(`[data-tab="${tab.value}"]`)
    ?.focus();
}
const destinationSource = computed(() =>
  model.value.sources.find((item) => item.path === destination.value?.path),
);
const draft = ref<SourceEdit | null>(null);
const removing = ref<PackageFeed | null>(null);
const pendingRequest = ref("");
const propertiesEpoch = ref(0);
type EditContext = Omit<SourceEditRequest, "edit" | "requestId">;
const draftContext = ref<EditContext | null>(null);
const busy = computed(
  () =>
    !!pendingRequest.value ||
    ["saving", "loading"].includes(model.value.sourceEditor?.status ?? ""),
);
const destination = computed(() =>
  model.value.sourceEditor?.destinations.find(
    (item) =>
      item.id ===
      (source.value?.origin === "effective"
        ? destinationId.value
        : source.value?.path),
  ),
);
const result = computed(() => model.value.sourceEditor);
function load(reload = false) {
  if (reload) {
    propertiesEpoch.value++;
    draft.value = null;
    removing.value = null;
    draftContext.value = null;
  }
  store.post({ type: "sourceEditor", reload });
}
onMounted(() => load());
watch(
  [() => model.value.selectedTargetId, () => model.value.selectedSourceId],
  () => {
    draft.value = null;
    removing.value = null;
    draftContext.value = null;
    pendingRequest.value = "";
    load();
  },
);
watch(
  () => result.value?.status,
  (status) => {
    if (status !== "loading") return;
    propertiesEpoch.value++;
    draft.value = null;
    removing.value = null;
    draftContext.value = null;
  },
);
watch(
  () => [result.value?.status, result.value?.requestId],
  () => {
    if (result.value?.requestId !== pendingRequest.value) return;
    if (result.value?.status === "saved") {
      propertiesEpoch.value++;
      draft.value = null;
      removing.value = null;
      draftContext.value = null;
    }
    if (["saved", "failed"].includes(result.value?.status ?? ""))
      pendingRequest.value = "";
  },
);
watch(destinationId, () => {
  draft.value = null;
  removing.value = null;
  draftContext.value = null;
});
function context(): EditContext | null {
  return source.value && destination.value
    ? {
        sourceId: source.value.id,
        sourceRevision: source.value.revision ?? "",
        destinationId: destination.value.id,
        destinationRevision: destination.value.revision,
      }
    : null;
}
function valueFor(feed?: PackageFeed): SourceEdit {
  return {
    action: "upsert",
    ...(feed ? { originalName: feed.name } : {}),
    name: feed?.name ?? "",
    url: feed
      ? source.value?.origin === "effective"
        ? feed.url
        : (feed.declaredUrl ?? feed.url)
      : "https://",
    enabled: feed?.enabled ?? true,
    allowInsecure: feed?.allowInsecure ?? false,
  };
}
function edit(feed?: PackageFeed) {
  removing.value = null;
  draftContext.value = context();
  draft.value = valueFor(feed);
}
function remove(feed: PackageFeed) {
  draft.value = null;
  draftContext.value = context();
  removing.value = feed;
}
function save(value: SourceEditRequest["edit"], captured = draftContext.value) {
  if (!captured || busy.value) return;
  pendingRequest.value = crypto.randomUUID();
  store.post({
    type: "editSource",
    request: {
      ...captured,
      requestId: pendingRequest.value,
      edit: { ...value },
    },
  });
}
function toggle(
  feed: PackageFeed,
  field: "enabled" | "allowInsecure",
  event: Event,
) {
  save(
    { ...valueFor(feed), [field]: (event.target as HTMLInputElement).checked },
    context(),
  );
  (event.target as HTMLInputElement).checked =
    field === "enabled" ? feed.enabled : !!feed.allowInsecure;
}
</script>

<template>
  <VscodeSplitPane
    class="block h-full min-h-0"
    storage-key="nuget.sourcesSplit"
    :initial="32"
  >
    <template #start>
      <div class="h-full overflow-auto border-r border-border-muted p-2">
        <button
          v-for="item in model.sources"
          :key="item.id"
          :disabled="busy"
          :class="
            rowClass(
              item.id === model.selectedSourceId,
              'block w-full rounded px-2 py-1 text-left text-xs',
            )
          "
          type="button"
          :title="item.path || item.scope"
          @click="store.selectSourceId(item.id)"
        >
          <span class="block truncate">{{
            item.origin === "effective" ? item.name : item.path
          }}</span>
          <span class="text-fg-muted">{{ item.origin }}</span>
        </button>
      </div>
    </template>
    <template #end>
      <div class="h-full overflow-auto p-3 text-xs">
        <div
          role="tablist"
          aria-label="Source configuration"
          class="mb-3 flex gap-1 border-b border-border-muted pb-2"
        >
          <button
            v-for="(item, index) in tabs"
            :id="`sources-${item}-tab`"
            :key="item"
            :data-tab="item"
            type="button"
            role="tab"
            :aria-selected="tab === item"
            :aria-controls="`sources-${item}-panel`"
            :tabindex="tab === item ? 0 : -1"
            class="rounded px-3 py-1.5"
            :class="
              tab === item
                ? 'bg-list-active text-list-active-fg'
                : 'text-fg-muted'
            "
            @click="tab = item"
            @keydown.right="moveTab($event, index + 1)"
            @keydown.left="moveTab($event, index - 1)"
            @keydown.home="moveTab($event, 0)"
            @keydown.end="moveTab($event, tabs.length - 1)"
          >
            {{ item }}
          </button>
        </div>
        <p
          v-if="model.sourceEditor?.message"
          class="mb-2 break-words"
          :class="
            model.sourceEditor.status === 'failed'
              ? 'text-error'
              : 'text-fg-muted'
          "
          role="status"
        >
          {{ model.sourceEditor.message }}
        </p>
        <div
          v-show="tab === 'Feeds'"
          id="sources-Feeds-panel"
          role="tabpanel"
          aria-labelledby="sources-Feeds-tab"
        >
          <div class="overflow-x-auto">
            <table
              v-if="source"
              class="w-full border-collapse text-left text-xs"
            >
              <thead>
                <tr>
                  <th class="p-2">Name</th>
                  <th class="p-2">URL</th>
                  <th class="p-2">Allow insecure</th>
                  <th class="p-2">Enabled</th>
                  <th class="p-2"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="feed in source.feeds"
                  :key="`${feed.name}:${feed.url}`"
                  class="border-t border-border-muted hover:bg-list-hover"
                >
                  <td class="p-2" :title="feed.sourceConfigId">
                    {{ feed.name
                    }}<span
                      v-if="
                        source.origin === 'effective' && feed.sourceConfigId
                      "
                      class="mt-1 block max-w-48 truncate text-fg-muted"
                      :title="feed.sourceConfigId"
                      >{{ feed.sourceConfigId }}</span
                    >
                  </td>
                  <td
                    class="max-w-80 truncate p-2 text-fg-muted"
                    :title="feed.url"
                  >
                    {{
                      source.origin === "effective"
                        ? feed.url
                        : (feed.declaredUrl ?? feed.url)
                    }}
                  </td>
                  <td class="p-2">
                    <input
                      type="checkbox"
                      :aria-label="`Allow insecure connections for ${feed.name}`"
                      :checked="feed.allowInsecure"
                      :disabled="busy || !destination"
                      @change="toggle(feed, 'allowInsecure', $event)"
                    />
                  </td>
                  <td class="p-2">
                    <input
                      type="checkbox"
                      :aria-label="`Enable ${feed.name}`"
                      :checked="feed.enabled"
                      :disabled="busy || !destination"
                      @change="toggle(feed, 'enabled', $event)"
                    />
                  </td>
                  <td class="whitespace-nowrap p-2">
                    <button
                      type="button"
                      :aria-label="`Edit ${feed.name}`"
                      :disabled="busy || !destination"
                      @click="edit(feed)"
                    >
                      <VscodeIcon icon="edit" /></button
                    ><button
                      type="button"
                      :aria-label="`Remove ${feed.name}`"
                      :disabled="busy || !destination"
                      class="ml-2"
                      @click="remove(feed)"
                    >
                      <VscodeIcon icon="trash" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-if="removing"
            class="mt-3 rounded border border-border-muted p-3"
            role="group"
            aria-label="Remove source"
          >
            <p>Remove {{ removing.name }} from {{ destination?.path }}?</p>
            <p class="mt-1 text-fg-muted">
              {{
                source?.origin === "effective"
                  ? "This writes clear plus the remaining effective sources to this destination. Later config files may still override it."
                  : "Removing this declaration may reveal an inherited source."
              }}
            </p>
            <button
              type="button"
              :disabled="busy"
              class="mt-2 mr-3 text-error"
              @click="
                save({
                  action: 'remove',
                  originalName: removing.name,
                  name: removing.name,
                  url: removing.url,
                  enabled: removing.enabled,
                  allowInsecure: !!removing.allowInsecure,
                })
              "
            >
              Remove</button
            ><button type="button" :disabled="busy" @click="removing = null">
              Cancel
            </button>
          </div>
          <form
            v-if="draft"
            class="mt-3 grid gap-2 rounded border border-border-muted p-3"
            @submit.prevent="save(draft)"
          >
            <fieldset :disabled="busy" class="grid min-w-0 gap-2">
              <label class="flex min-w-0 items-center gap-2"
                >Name<input
                  v-model="draft.name"
                  required
                  aria-label="Source name"
                  class="min-w-0 flex-1 rounded border border-input-border bg-input px-2 py-1 text-input-fg"
              /></label>
              <label class="flex items-center gap-2"
                >URL or folder<input
                  v-model="draft.url"
                  required
                  aria-label="Source URL or folder"
                  class="min-w-0 flex-1 rounded border border-input-border bg-input px-2 py-1 text-input-fg"
              /></label>
              <label
                ><input v-model="draft.enabled" type="checkbox" />
                Enabled</label
              ><label
                ><input v-model="draft.allowInsecure" type="checkbox" /> Allow
                insecure HTTP connections</label
              >
              <p class="break-all text-fg-muted">
                Relative folders are resolved from {{ destination?.path }}.
                Existing relative values are preserved.
              </p>
              <p
                v-if="
                  source?.origin === 'effective' &&
                  draft.originalName &&
                  draft.originalName !== draft.name
                "
                class="text-fg-muted"
              >
                Renaming replaces the inherited source list at this destination.
                Other projects using this file may be affected.
              </p>
              <div>
                <button
                  type="submit"
                  :disabled="busy || !destination"
                  class="mr-3 rounded bg-button px-3 py-1 text-button-fg"
                >
                  Save</button
                ><button type="button" :disabled="busy" @click="draft = null">
                  Cancel
                </button>
              </div>
            </fieldset>
          </form>
          <p v-if="source && !source.feeds.length" class="mt-3 text-fg-muted">
            No feeds declared in this configuration.
          </p>
          <button
            v-if="!draft && !removing"
            type="button"
            :disabled="busy || !source || !destination"
            class="mt-3 inline-flex items-center gap-1 text-list-highlight"
            @click="edit()"
          >
            <VscodeIcon icon="add" /> New feed
          </button>
        </div>
        <div
          v-if="tab === 'Properties'"
          id="sources-Properties-panel"
          role="tabpanel"
          aria-labelledby="sources-Properties-tab"
        >
          <SourceProperties
            :key="`${source?.id}:${destination?.id}:${propertiesEpoch}`"
            :source="source"
            :effective-source="
              model.sources.find((item) => item.origin === 'effective')
            "
            :destination="destinationSource"
            :context="context()"
            :disabled="busy || !destination"
            @save="save"
          />
        </div>
        <div
          v-if="tab === 'Summary'"
          id="sources-Summary-panel"
          role="tabpanel"
          aria-labelledby="sources-Summary-tab"
        >
          <SourceSummary :source="source" />
        </div>
      </div>
    </template>
  </VscodeSplitPane>
</template>
