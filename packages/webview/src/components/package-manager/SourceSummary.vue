<script setup lang="ts">
import { computed } from "vue";
import type { NuGetConfigFile } from "#contracts";
const props = defineProps<{ source?: NuGetConfigFile | undefined }>();
const summary = computed(() => {
  const source = props.source;
  if (!source) return "Select a configuration file.";
  const flag = (value: boolean | null | undefined) =>
    value == null ? "Unknown" : value ? "True" : "False";
  const consent = source.restoreConsent;
  const lines = [
    source.origin === "effective"
      ? "### Displaying the effective NuGet.Config, which is a result of combining the following files:"
      : "### Displaying NuGet.Config:",
    ...(source.configPaths ?? [source.path]).map((file) => `    ${file}`),
    "",
    "### Restore consent",
    `    IsGranted = ${flag(consent?.isGranted).toLowerCase()}, IsGrantedInSettings = ${flag(consent?.isGrantedInSettings).toLowerCase()}, IsAutomatic = ${flag(consent?.isAutomatic).toLowerCase()}`,
    "",
    "### Feeds",
  ];
  for (const feed of source.feeds)
    lines.push(
      `* ${feed.name}`,
      `Source = ${feed.url} (ProtocolVersion = ${feed.protocolVersion ?? 2}; IsHttp = ${flag(feed.isHttp)}; AllowInsecureConnections = ${flag(feed.allowInsecure ?? false)}; DisableTLSCertificateValidation = ${flag(feed.disableTLSCertificateValidation ?? false)})`,
      `    IsOfficial = ${flag(feed.isOfficial)}; IsMachineWide = ${flag(feed.isMachineWide)}; IsLocal = ${flag(feed.isLocal)}`,
      `    IsEnabled = ${flag(feed.enabled)}; IsPersistable = ${flag(feed.isPersistable)}`,
      "",
    );
  if (!source.feeds.length) lines.push("  No feeds declared.", "");
  lines.push(
    "### FallbackFolders",
    ...(source.fallbackFolders?.map((folder) => `* ${folder}`) ?? []),
  );
  return lines.join("\n");
});
</script>
<template>
  <pre
    class="overflow-auto whitespace-pre-wrap break-all rounded border border-border-muted p-3 font-mono text-xs leading-relaxed"
    tabindex="0"
    aria-label="NuGet configuration summary"
    >{{ summary }}</pre
  >
</template>
