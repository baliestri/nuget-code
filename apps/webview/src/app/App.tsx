import type { SessionState } from "@nuget-code/bridge";
import type { ReactNode } from "react";
import { useBridge, useSession } from "../bridge/BridgeContext";
import { FoldersTab } from "../folders/FoldersTab";
import { LogTab } from "../log/LogTab";
import { PackagesTab } from "../packages/PackagesTab";
import { SourcesTab } from "../sources/SourcesTab";
import { usePreferences } from "../state/PreferencesContext";
import { TABS, type TabId } from "../state/preferences";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { LinkButton } from "../ui/LinkButton";
import { Spinner } from "../ui/Spinner";
import { Placeholder } from "./Placeholder";

const TITLES: Record<TabId, string> = { packages: "Packages", sources: "Sources", folders: "Folders", log: "Log" };

/** The view: the tabs, and what stands in for them while there is no backend or no solution. */
export function App(): ReactNode {
  const bridge = useBridge();
  const session = useSession();
  const { preferences, set } = usePreferences();
  const tab = preferences.tab;
  const host = (request: "selectSolution" | "showLog" | "restartBackend"): void =>
    void bridge.host(request, {}).catch(() => {});

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <span className="pr-2 font-semibold">NuGet</span>
        <div role="tablist" aria-label="NuGet" className="flex gap-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls="tab-panel"
              onClick={() => set({ tab: id })}
              className={`rounded px-2 py-0.5 ${tab === id ? "bg-selection text-selection-fg" : "hover:bg-hover"}`}
            >
              {TITLES[id]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {session?.solution.kind === "open" ? (
          <button
            type="button"
            title="Select another solution"
            onClick={() => host("selectSolution")}
            className="text-muted hover:bg-hover flex items-center gap-1 rounded px-2 py-0.5"
          >
            <i className="codicon codicon-file-code" aria-hidden="true" />
            {session.solution.name}
          </button>
        ) : null}
      </header>
      {session?.backend === "ready" && !session.hasSdk ? (
        <Banner
          kind="warning"
          actions={
            <LinkButton onClick={() => void bridge.host("openSettings", { query: "nuget.dotnetPath" }).catch(() => {})}>
              Open Settings
            </LinkButton>
          }
        >
          The .NET SDK was not found. Sources can be listed and packages searched, but no solution can be opened.
        </Banner>
      ) : null}
      <main id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-h-0 flex-1">
        <Content tab={tab} session={session} host={host} />
      </main>
    </div>
  );
}

function Content({
  tab,
  session,
  host
}: {
  tab: TabId;
  session: SessionState | undefined;
  host(request: "selectSolution" | "showLog" | "restartBackend"): void;
}): ReactNode {
  if (session === undefined || session.backend === "starting") {
    return (
      <Placeholder title="Starting…">
        <Spinner label="Starting the NuGet backend" />
      </Placeholder>
    );
  }

  if (session.backend === "stopped") {
    return (
      <Placeholder title="The NuGet backend is not running">
        <div className="flex gap-2">
          <Button onClick={() => host("restartBackend")}>Restart</Button>
          <Button variant="secondary" onClick={() => host("showLog")}>
            Show Log
          </Button>
        </div>
      </Placeholder>
    );
  }

  switch (tab) {
    case "packages":
      // The other tabs work without a solution; the package lists are about one.
      if (session.solution.kind === "opening") {
        return (
          <Placeholder title="Opening the solution…">
            <Spinner label="Opening the solution" />
          </Placeholder>
        );
      }

      if (session.solution.kind === "none") {
        return (
          <Placeholder title="Select a solution">
            <p>NuGet works on one solution of the workspace at a time.</p>
            <Button onClick={() => host("selectSolution")}>Select Solution</Button>
          </Placeholder>
        );
      }

      return <PackagesTab />;
    case "sources":
      return <SourcesTab />;
    case "folders":
      return <FoldersTab />;
    case "log":
      return <LogTab />;
  }
}
