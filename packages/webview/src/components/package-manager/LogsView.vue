<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { LogEntry, LogLevel } from "#contracts";
import { useAutoScroll } from "#webview/composables/useAutoScroll";
import {
  readBoolean,
  readStringList,
  writeBoolean,
  writeStringList,
} from "#webview/composables/useLocalStorage";
import VscodeButton from "#webview/components/vscode/VscodeButton.vue";
import VscodeMultiSelect from "#webview/components/vscode/VscodeMultiSelect.vue";
import VscodeToggleButton from "#webview/components/vscode/VscodeToggleButton.vue";
import { formatLogTimestamp } from "#webview/lib/format";
import { logLevelClass, logLevels } from "#webview/lib/ui";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const store = usePackageManagerStore();
const { model } = storeToRefs(store);
const showTimestamp = ref(readBoolean("nuget.logs.timestamp", true));
const showContext = ref(readBoolean("nuget.logs.context", true));
const showLevel = ref(readBoolean("nuget.logs.level", true));
const softWrap = ref(readBoolean("nuget.logs.softWrap", false));
const selectedLogLevels = ref<LogLevel[]>(
  readStringList("nuget.logs.levels", [...logLevels], logLevels),
);
const logPanel = ref<HTMLElement>();
const { scrollToEnd } = useAutoScroll(logPanel);
const selectedLevelSet = computed(() => new Set(selectedLogLevels.value));
const logs = computed(() =>
  model.value.logs.filter((entry) => selectedLevelSet.value.has(entry.level)),
);
const logLevelOptions = computed(() =>
  logLevels.map((level) => ({ value: level, label: level })),
);

watch(
  () => model.value.logs.length,
  () => {
    void scrollToEnd();
  },
);

function setShowTimestamp(value: boolean): void {
  showTimestamp.value = value;
  writeBoolean("nuget.logs.timestamp", value);
}

function setShowContext(value: boolean): void {
  showContext.value = value;
  writeBoolean("nuget.logs.context", value);
}

function setShowLevel(value: boolean): void {
  showLevel.value = value;
  writeBoolean("nuget.logs.level", value);
}

function setSoftWrap(value: boolean): void {
  softWrap.value = value;
  writeBoolean("nuget.logs.softWrap", value);
}

function setSelectedLogLevels(value: string[]): void {
  selectedLogLevels.value = value as LogLevel[];
  writeStringList("nuget.logs.levels", selectedLogLevels.value);
}

function entryKey(entry: LogEntry, index: number): string {
  return `${entry.timestamp}:${entry.context}:${index}`;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-muted p-1"
    >
      <VscodeToggleButton
        :label="`${showTimestamp ? 'Hide' : 'Show'} timestamp`"
        icon="clockface"
        :active="showTimestamp"
        @toggle-change="setShowTimestamp"
      />
      <VscodeToggleButton
        :label="`${showContext ? 'Hide' : 'Show'} context`"
        icon="symbol-keyword"
        :active="showContext"
        @toggle-change="setShowContext"
      />
      <VscodeToggleButton
        :label="`${showLevel ? 'Hide' : 'Show'} level`"
        icon="layers"
        :active="showLevel"
        @toggle-change="setShowLevel"
      />
      <span class="text-fg-muted">|</span>
      <VscodeToggleButton
        :label="`${softWrap ? 'Disable' : 'Enable'} soft wrap`"
        icon="word-wrap"
        :active="softWrap"
        @toggle-change="setSoftWrap"
      />
      <VscodeButton
        variant="ghost"
        icon="arrow-down"
        label="Scroll to end"
        @click="scrollToEnd"
      />
      <VscodeButton
        variant="ghost"
        icon="clear-all"
        label="Clear"
        :disabled="model.logs.length === 0"
        @click="store.runCommand('clearLogs')"
      />
      <span class="text-fg-muted">|</span>
      <VscodeMultiSelect
        :options="logLevelOptions"
        :selected="selectedLogLevels"
        label="Level"
        selection-mode="minimum"
        @selection-change="setSelectedLogLevels"
      />
    </div>
    <div
      ref="logPanel"
      :class="`min-h-0 flex-1 overflow-auto bg-surface-0 p-2 font-mono text-xs ${softWrap ? 'overflow-x-hidden' : ''}`"
    >
      <div
        v-for="(entry, index) in logs"
        :key="entryKey(entry, index)"
        :class="`flex items-start gap-1 leading-5 ${softWrap ? 'w-full min-w-0' : 'min-w-max'}`"
      >
        <span v-if="showTimestamp" class="shrink-0 text-fg-muted">
          [{{ formatLogTimestamp(entry.timestamp) }}]
        </span>
        <span
          v-if="showLevel"
          :class="`shrink-0 ${logLevelClass(entry.level)}`"
        >
          [{{ entry.level }}]
        </span>
        <span v-if="showContext" class="shrink-0 text-info">
          [{{ entry.context }}]
        </span>
        <span
          :class="
            softWrap
              ? 'min-w-0 flex-1 whitespace-pre-wrap break-words'
              : 'whitespace-pre'
          "
        >
          {{ entry.message }}
        </span>
      </div>
    </div>
  </div>
</template>
