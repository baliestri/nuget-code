import type { FolderInfo, FoldersClearResult, FolderSizeResult } from "@nuget-code/protocol";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { SideBar } from "../app/SideBar";
import { useBridge } from "../bridge/BridgeContext";
import { formatBytes } from "../lib/format";
import { queryKeys } from "../packages/queries";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconButton } from "../ui/IconButton";

/** What is known about the size of a folder: nothing yet, being measured, measured, or why it could not be. */
type Size = "measuring" | FolderSizeResult | { failed: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const CELL = "border-border border-b px-2 py-0.5";
const SKIPPED_SHOWN = 5;

function sizeText(size: Size | undefined): string {
  if (size === undefined) {
    return "?";
  }

  if (size === "measuring") {
    return "…";
  }

  if ("failed" in size) {
    return "failed";
  }

  return size.exists ? formatBytes(size.bytes) : "—";
}

/** What clearing did, one line for each thing worth saying. */
export function describeCleared(result: FoldersClearResult, folders: readonly FolderInfo[]): string[] {
  return result.folders.flatMap((cleared) => {
    const title = folders.find((folder) => folder.path === cleared.path)?.title ?? cleared.path;
    const lines = [`${title}: ${formatBytes(cleared.bytesFreed)} freed.`];
    if (cleared.skipped.length > 0) {
      const more = cleared.skipped.length - SKIPPED_SHOWN;
      lines.push(
        `${title}: ${cleared.skipped.length} could not be removed, probably in use: ${cleared.skipped
          .slice(0, SKIPPED_SHOWN)
          .join(", ")}${more > 0 ? ` and ${more} more` : ""}.`
      );
    }

    return lines;
  });
}

/** The Folders tab: where NuGet keeps things, how much each holds, and a way to empty the caches. */
export function FoldersTab(): ReactNode {
  const bridge = useBridge();
  const list = useQuery({ queryKey: queryKeys.folders, queryFn: () => bridge.backend("listFolders", {}) });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const [measuring, setMeasuring] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** What went wrong clearing, measuring or opening. What went well is a notification of the editor. */
  const [problems, setProblems] = useState<readonly string[]>([]);

  const folders = list.data?.folders ?? [];
  const chosen = folders.filter((folder) => selected.has(folder.path));
  const only = chosen.length === 1 ? chosen[0] : undefined;
  const canClear = chosen.length > 0 && chosen.every((folder) => folder.clearable) && !clearing;

  const setSize = (path: string, size: Size | undefined): void =>
    setSizes((current) => {
      const next = new Map(current);
      if (size === undefined) {
        next.delete(path);
      } else {
        next.set(path, size);
      }

      return next;
    });

  /** Measures the folders one after the other: each one walks a tree on disk. */
  const recalculate = async (before: readonly string[] = []): Promise<void> => {
    if (measuring) {
      setProblems(before);
      return;
    }

    setMeasuring(true);
    // `before` is what already went wrong in the action that asked for the sizes again.
    const failed = [...before];
    try {
      for (const folder of folders) {
        setSize(folder.path, "measuring");
        try {
          setSize(folder.path, await bridge.backend("folderSize", { path: folder.path }));
        } catch (error) {
          // Said in the row and above the table: a size that silently stays unknown explains nothing.
          setSize(folder.path, { failed: messageOf(error) });
          failed.push(`${folder.title} could not be measured. ${messageOf(error)}`);
        }
      }
    } finally {
      setMeasuring(false);
      setProblems(failed);
    }
  };

  const openFolder = (path: string): void =>
    void bridge
      .host("openFolder", { path })
      .catch((error: unknown) => setProblems([`The folder could not be opened. ${messageOf(error)}`]));

  const clear = async (): Promise<void> => {
    setConfirming(false);
    setClearing(true);
    const refused: string[] = [];
    try {
      const result = await bridge.backend("clearFolders", { paths: chosen.map((folder) => folder.path) });
      // How it ended is the editor's to say; the table shows the new sizes.
      const skipped = result.folders.some((folder) => folder.skipped.length > 0);
      void bridge
        .host("notify", { kind: skipped ? "warning" : "info", messages: describeCleared(result, folders) })
        .catch(() => {});
    } catch (error) {
      refused.push(`The folders were not cleared. ${messageOf(error)}`);
    } finally {
      setClearing(false);
    }

    await recalculate(refused);
  };

  const select = (path: string, add: boolean): void => {
    if (!add) {
      setSelected(new Set([path]));
      return;
    }

    const next = new Set(selected);
    if (!next.delete(path)) {
      next.add(path);
    }

    setSelected(next);
  };

  return (
    <>
      <SideBar>
        <IconButton
          icon="refresh"
          label="Recalculate Folder Sizes"
          disabled={measuring || folders.length === 0}
          onClick={() => void recalculate()}
        />
        <IconButton
          icon="folder-opened"
          label="Open Folder"
          disabled={only === undefined}
          onClick={() => openFolder(only!.path)}
        />
        <IconButton
          icon="trash"
          label="Clear Selected Caches"
          disabled={!canClear}
          onClick={() => setConfirming(true)}
        />
      </SideBar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {problems.length === 0 ? null : (
          <Banner kind="error" actions={<IconButton icon="close" label="Dismiss" onClick={() => setProblems([])} />}>
            <ul>
              {problems.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Banner>
        )}
        {list.data === undefined ? (
          list.isError ? (
            <Placeholder title="The folders could not be listed">{list.error.message}</Placeholder>
          ) : (
            <Placeholder title="Loading the folders…" />
          )
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table aria-multiselectable="true" className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={`${CELL} font-normal`}>
                    Title
                  </th>
                  <th scope="col" className={`${CELL} font-normal`}>
                    Path
                  </th>
                  <th scope="col" className={`${CELL} font-normal`}>
                    Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {folders.map((folder) => {
                  const on = selected.has(folder.path);
                  return (
                    <tr
                      key={folder.path}
                      aria-selected={on}
                      tabIndex={0}
                      onClick={(event) => select(folder.path, event.ctrlKey || event.metaKey)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          select(folder.path, event.ctrlKey || event.metaKey);
                        }
                      }}
                      className={`cursor-default ${on ? "bg-selection text-selection-fg" : "hover:bg-hover"}`}
                    >
                      <th scope="row" className={`${CELL} w-px text-left font-normal whitespace-nowrap`}>
                        {folder.title}
                      </th>
                      <td className={`${CELL} break-all`}>{folder.path}</td>
                      <td className={`${CELL} w-px text-right whitespace-nowrap`}>
                        {sizeText(sizes.get(folder.path))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirming ? (
        <Dialog title="Clear the selected caches?" onClose={() => setConfirming(false)}>
          <p>Everything in these folders is deleted. Packages are downloaded again when a restore needs them.</p>
          <ul aria-label="Folders to clear" className="flex flex-col gap-1">
            {chosen.map((folder) => {
              const size = sizes.get(folder.path);
              return (
                <li key={folder.path}>
                  <span className="font-semibold">{folder.title}</span>
                  {typeof size === "object" && "exists" in size && size.exists ? ` (${formatBytes(size.bytes)})` : ""}
                  <div className="text-muted break-all">{folder.path}</div>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-2">
            <Button onClick={() => void clear()}>Clear</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
