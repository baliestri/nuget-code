import type { ReactNode } from "react";
import { useBridge } from "../bridge/BridgeContext";
import { IconButton } from "../ui/IconButton";

export const HELP_URL = "https://github.com/baliestri/nuget-code/blob/main/wiki/extension.md";

interface SideBarProps {
  /** Runs a restore; absent while it cannot run. */
  onRestore?: (() => void) | undefined;
  /** The buttons of the tab, between Restore and Settings. */
  children?: ReactNode;
}

/** The column of icon buttons on the left of every tab: Restore, the tab's own actions, Settings, Help. */
export function SideBar({ onRestore, children }: SideBarProps): ReactNode {
  const bridge = useBridge();
  return (
    <nav aria-label="Actions" className="border-border flex shrink-0 flex-col items-center gap-1 border-r px-1 py-2">
      <IconButton icon="cloud-download" label="Restore" onClick={onRestore} disabled={onRestore === undefined} />
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
