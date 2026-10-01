<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from "vue";
import type { PackageFeed, PackageFeedFilter } from "#contracts";
const props = defineProps<{
  feeds: PackageFeed[];
  filter: PackageFeedFilter;
}>();
const emit = defineEmits<{ change: [filter: PackageFeedFilter]; manage: [] }>();
const dropdown = ref<HTMLDetailsElement>();
const panel = ref<HTMLElement>();
const panelStyle = ref({ left: "0px", top: "0px", maxHeight: "80vh" });
async function positionPanel(): Promise<void> {
  if (!dropdown.value?.open) return;
  await nextTick();
  const anchor = dropdown.value
    ?.querySelector("summary")
    ?.getBoundingClientRect();
  const bounds = panel.value?.getBoundingClientRect();
  if (!anchor || !bounds) return;
  const left = Math.max(
    8,
    Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8),
  );
  const below = window.innerHeight - anchor.bottom - 12;
  const above = anchor.top - 12;
  const top =
    below >= bounds.height || below >= above
      ? anchor.bottom + 4
      : Math.max(8, anchor.top - bounds.height - 4);
  panelStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${Math.max(40, window.innerHeight - top - 8)}px`,
  };
}
onMounted(() => window.addEventListener("resize", positionPanel));
onUnmounted(() => window.removeEventListener("resize", positionPanel));
const enabled = computed(() =>
  props.feeds.filter((feed) => feed.enabled && feed.id !== "__all__"),
);
const ids = computed(() =>
  props.filter.mode === "all"
    ? enabled.value.map((feed) => feed.id)
    : props.filter.ids,
);
const label = computed(() =>
  props.filter.mode === "all"
    ? "All enabled feeds"
    : ids.value.length === 0
      ? "No feeds selected"
      : ids.value.length === 1
        ? (enabled.value.find((feed) => feed.id === ids.value[0])?.name ??
          "No feeds selected")
        : `${ids.value.length} feeds selected`,
);
function toggle(id: string, event: Event): void {
  const selected = new Set(ids.value);
  if ((event.target as HTMLInputElement).checked) selected.add(id);
  else selected.delete(id);
  emit("change", { mode: "selected", ids: [...selected] });
}
function close(): void {
  if (dropdown.value) {
    dropdown.value.open = false;
    dropdown.value.querySelector("summary")?.focus();
  }
}
</script>
<template>
  <details
    ref="dropdown"
    class="relative max-w-full text-sm"
    @keydown.esc.stop="close"
    @toggle="positionPanel"
    @focusout="
      (event) => {
        if (dropdown && !dropdown.contains(event.relatedTarget as Node))
          dropdown.open = false;
      }
    "
  >
    <summary
      class="cursor-pointer truncate rounded border border-dropdown-border bg-dropdown px-2 py-1 text-dropdown-fg"
      :title="label"
    >
      {{ label }}
    </summary>
    <div
      ref="panel"
      :style="panelStyle"
      class="fixed z-50 grid w-72 max-w-[85vw] gap-2 overflow-auto rounded border border-dropdown-border bg-dropdown p-3 text-dropdown-fg shadow-lg"
    >
      <label class="flex items-center gap-2"
        ><input
          type="checkbox"
          :checked="filter.mode === 'all'"
          @change="
            emit(
              'change',
              ($event.target as HTMLInputElement).checked
                ? { mode: 'all' }
                : { mode: 'selected', ids: [] },
            )
          "
        />All enabled feeds</label
      >
      <fieldset
        class="grid max-h-64 gap-2 overflow-auto border-t border-border-muted pt-2"
      >
        <legend class="text-xs text-fg-muted">Enabled Feeds</legend>
        <label
          v-for="feed in enabled"
          :key="feed.id"
          class="flex min-w-0 items-start gap-2"
          ><input
            type="checkbox"
            :checked="ids.includes(feed.id)"
            :aria-label="`${feed.name}: ${feed.url}`"
            @change="toggle(feed.id, $event)"
          /><span class="min-w-0"
            ><span class="block truncate">{{ feed.name }}</span
            ><span
              class="block truncate text-xs text-fg-muted"
              :title="feed.url"
              >{{ feed.url }}</span
            ></span
          ></label
        >
        <p v-if="!enabled.length" class="text-fg-muted">No enabled feeds.</p>
      </fieldset>
      <button
        type="button"
        class="border-t border-border-muted pt-2 text-left text-list-highlight"
        @click="
          close();
          emit('manage');
        "
      >
        Manage Feeds
      </button>
    </div>
  </details>
</template>
