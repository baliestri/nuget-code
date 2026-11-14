import type { FeedInfo, SourceProperty } from "@nuget-code/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { SideBar } from "../app/SideBar";
import { useBridge } from "../bridge/BridgeContext";
import { queryKeys, useSources } from "../packages/queries";
import { usePreferences } from "../state/PreferencesContext";
import { Banner } from "../ui/Banner";
import { IconButton } from "../ui/IconButton";
import { FeedDialog, type FeedValues } from "./FeedDialog";
import { FeedsTable } from "./FeedsTable";
import { PropertiesView } from "./PropertiesView";
import { buildSummary, EFFECTIVE, feedTarget } from "./summary";

const VIEWS = ["Feeds", "Properties", "Summary"] as const;
type View = (typeof VIEWS)[number];

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The Sources tab: the NuGet.config files on one side, the feeds and folders of the selected one on the other. */
export function SourcesTab(): ReactNode {
  const bridge = useBridge();
  const queries = useQueryClient();
  const { preferences, set } = usePreferences();
  const sources = useSources();
  const [selected, setSelected] = useState(EFFECTIVE);
  const [view, setView] = useState<View>("Feeds");
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<{ feed: FeedInfo | undefined }>();

  const reload = (): void => {
    void queries.invalidateQueries({ queryKey: queryKeys.sources });
    // What the feeds answer depends on which feeds there are.
    for (const key of ["updates", "search", "details"]) {
      void queries.invalidateQueries({ queryKey: [key] });
    }
  };
  /** Runs a change that has no dialog of its own: a failure is shown above the table. */
  const change = (action: () => Promise<unknown>): void => {
    setError(undefined);
    void action()
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(reload);
  };

  const side = preferences.detailsPosition === "side";
  const bar = (
    <SideBar>
      <IconButton icon="refresh" label="Reload" onClick={reload} />
      <IconButton
        icon={side ? "split-vertical" : "split-horizontal"}
        label={side ? "Show Details Below" : "Show Details on the Side"}
        onClick={() => set({ detailsPosition: side ? "bottom" : "side" })}
      />
    </SideBar>
  );

  const data = sources.data;
  if (data === undefined) {
    return (
      <>
        {bar}
        {sources.isError ? (
          <Placeholder title="The sources could not be read">{sources.error.message}</Placeholder>
        ) : (
          <Placeholder title="Loading the sources…" />
        )}
      </>
    );
  }

  // A file that is no longer listed falls back to the effective view.
  const file = data.files.find((item) => item.path === selected);
  const current = file === undefined ? EFFECTIVE : file.path;
  const fileOf = (feed: FeedInfo): typeof file => file ?? data.files.find((item) => item.path === feed.declaredIn);
  const canEdit = (feed: FeedInfo): boolean => !feed.isMachineWide && (fileOf(feed)?.writable ?? true);

  const save = async (values: FeedValues, original: FeedInfo | undefined): Promise<void> => {
    const written = {
      source: values.source,
      enabled: values.enabled,
      allowInsecureConnections: values.allowInsecureConnections,
      disableTlsCertificateValidation: values.disableTlsCertificateValidation
    };
    try {
      await (original === undefined
        ? bridge.backend("addSource", { ...feedTarget(current, undefined), name: values.name, ...written })
        : bridge.backend("updateSource", {
            ...feedTarget(current, original),
            name: original.name,
            ...(values.name === original.name ? {} : { newName: values.name }),
            ...written
          }));
    } finally {
      reload();
    }

    setDialog(undefined);
    setError(undefined);
    if (values.username !== "" && values.password !== "") {
      // The feed is written by now; a failure here must not ask for it to be written again.
      await bridge
        .host("saveCredential", { source: values.source, username: values.username, password: values.password })
        .catch((reason: unknown) => setError(`The feed was saved, but its credentials were not. ${messageOf(reason)}`));
    }
  };

  const setProperty = (property: SourceProperty, value: string): void => {
    if (file !== undefined) {
      change(() =>
        bridge.backend("setSourceProperty", { file: file.path, property, ...(value === "" ? {} : { value }) })
      );
    }
  };

  return (
    <>
      {bar}
      <div className={`flex min-h-0 min-w-0 flex-1 ${side ? "flex-row" : "flex-col"}`}>
        <ul aria-label="Configuration files" className="min-h-0 min-w-0 flex-1 overflow-y-auto py-1">
          {[EFFECTIVE, ...data.files.map((item) => item.path)].map((path) => (
            <li key={path}>
              <button
                type="button"
                aria-pressed={path === current}
                onClick={() => setSelected(path)}
                className={`w-full truncate px-2 py-0.5 text-left ${
                  path === current ? "bg-selection text-selection-fg" : "hover:bg-hover"
                }`}
              >
                {path === EFFECTIVE ? "[Effective NuGet.Config]" : path}
              </button>
            </li>
          ))}
        </ul>
        <section
          aria-label="Details"
          className={`border-border flex min-h-0 min-w-0 flex-[2] flex-col ${side ? "border-l" : "border-t"}`}
        >
          <div role="tablist" aria-label="Source details" className="flex gap-1 px-2 py-1.5">
            {VIEWS.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={view === name}
                onClick={() => setView(name)}
                className={`rounded border px-2 py-0.5 ${
                  view === name ? "border-border bg-surface" : "hover:bg-hover border-transparent"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {error === undefined ? null : (
            <Banner
              kind="error"
              actions={<IconButton icon="close" label="Dismiss" onClick={() => setError(undefined)} />}
            >
              {error}
            </Banner>
          )}
          {file !== undefined && !file.writable && view !== "Summary" ? (
            <Banner kind="info">
              {file.isMachineWide
                ? "This file belongs to the machine. Its feeds can be enabled and disabled, and nothing else."
                : "This file cannot be written, so it is read-only here."}
            </Banner>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
            {view === "Feeds" ? (
              <FeedsTable
                feeds={file?.feeds ?? data.effective}
                canEdit={canEdit}
                canToggle={(feed) => canEdit(feed) || feed.isMachineWide}
                canAdd={file === undefined || (file.writable && !file.isMachineWide)}
                onEnabled={(feed, enabled) =>
                  change(() =>
                    bridge.backend("updateSource", { ...feedTarget(current, feed), name: feed.name, enabled })
                  )
                }
                onAllowInsecure={(feed, allowInsecureConnections) =>
                  change(() =>
                    bridge.backend("updateSource", {
                      ...feedTarget(current, feed),
                      name: feed.name,
                      allowInsecureConnections
                    })
                  )
                }
                onEdit={(feed) => setDialog({ feed })}
                onRemove={(feed) =>
                  change(() => bridge.backend("removeSource", { ...feedTarget(current, feed), name: feed.name }))
                }
                onAdd={() => setDialog({ feed: undefined })}
              />
            ) : view === "Properties" ? (
              <PropertiesView
                key={current}
                globalPackagesFolder={file?.globalPackagesFolder}
                repositoryPath={file?.repositoryPath}
                resolvedGlobalPackagesFolder={data.globalPackagesFolder}
                resolvedLocalPackagesFolder={data.localPackagesFolder}
                readOnly={file === undefined || !file.writable || file.isMachineWide}
                onSet={setProperty}
                onPick={async (title) => (await bridge.host("pickFolder", { title })).path}
              />
            ) : (
              <pre aria-label="Summary" className="p-2 font-mono whitespace-pre-wrap select-text">
                {buildSummary(data)}
              </pre>
            )}
          </div>
        </section>
      </div>
      {dialog === undefined ? null : (
        <FeedDialog
          feed={dialog.feed}
          onSave={(values) => save(values, dialog.feed)}
          onClose={() => setDialog(undefined)}
        />
      )}
    </>
  );
}
