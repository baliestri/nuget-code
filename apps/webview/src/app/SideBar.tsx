import type { ReactNode } from "react";
import { useBridge, useSession } from "../bridge/BridgeContext";
import { useOperation } from "../state/operation";
import { IconButton } from "../ui/IconButton";

export const HELP_URL = "https://github.com/baliestri/nuget-code/blob/main/wiki/nuget-view.md";

/**
 * The column of icon buttons on the left of every tab: Restore, the tab's own actions (the children),
 * Settings and Help.
 */
export function SideBar({ children }: { children?: ReactNode }): ReactNode {
  const bridge = useBridge();
  const session = useSession();
  const operation = useOperation();
  const canRestore = session?.backend === "ready" && session.solution.kind === "open" && !operation.running;
  return (
    <nav aria-label="Actions" className="border-border flex shrink-0 flex-col items-center gap-1 border-r px-1 py-2">
      <IconButton
        icon="cloud-download"
        label="Restore"
        disabled={!canRestore}
        onClick={() => void operation.run("Restore", () => bridge.backend("restore", { force: false }))}
      />
      {children}
      <IconButton
        icon="settings-gear"
        label="NuGet Settings"
        onClick={() => void bridge.host("openSettings", { query: "nuget" }).catch(() => {})}
      />
      <IconButton
        icon="question"
        label="Help"
        onClick={() => void bridge.host("openExternal", { url: HELP_URL }).catch(() => {})}
      />
    </nav>
  );
}
