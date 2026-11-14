import type { FeedInfo, SourcesListResult } from "@nuget-code/protocol";

/** The entry of the file list that stands for every file combined. */
export const EFFECTIVE = "effective";

/**
 * The file a change to the sources is written to. From the list of one file, that file. From the effective
 * view, the file that declares the feed; a new feed names none, and the backend puts it in the NuGet.config
 * of the solution.
 */
export function feedTarget(view: string, feed: FeedInfo | undefined): { file?: string } {
  if (view !== EFFECTIVE) {
    return { file: view };
  }

  return feed?.declaredIn === undefined ? {} : { file: feed.declaredIn };
}

const INDENT = "    ";

/** The effective configuration as text: the files it combines, the feeds with what is set on each, the folders. */
export function buildSummary(sources: SourcesListResult): string {
  const lines = ["### Displaying the effective NuGet.Config, which is a result of combining the following files:"];
  for (const file of sources.files) {
    lines.push(`${INDENT}${file.path}`);
  }

  lines.push("", "### Feeds");
  for (const feed of sources.effective) {
    lines.push(
      `* ${feed.name}`,
      `${INDENT}Source = ${feed.source} (ProtocolVersion = ${feed.protocolVersion}; AllowInsecureConnections = ${feed.allowInsecureConnections}; DisableTLSCertificateValidation = ${feed.disableTlsCertificateValidation})`,
      `${INDENT}IsEnabled = ${feed.enabled}; IsMachineWide = ${feed.isMachineWide}; IsLocal = ${feed.isLocal}`
    );
    if (feed.declaredIn !== undefined) {
      lines.push(`${INDENT}DeclaredIn = ${feed.declaredIn}`);
    }
  }

  lines.push("", "### Folders", `${INDENT}GlobalPackagesFolder = ${sources.globalPackagesFolder}`);
  if (sources.localPackagesFolder !== undefined) {
    lines.push(`${INDENT}LocalPackagesFolder = ${sources.localPackagesFolder}`);
  }

  lines.push("", "### FallbackFolders");
  for (const folder of sources.fallbackFolders) {
    lines.push(`* ${folder}`);
  }

  return lines.join("\n");
}
