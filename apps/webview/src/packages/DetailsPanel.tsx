import type { ProjectInfo } from "@nuget-code/protocol";
import { useState, type ReactNode } from "react";
import { Placeholder } from "../app/Placeholder";
import { useBridge } from "../bridge/BridgeContext";
import { projectIconUrl } from "../lib/assets";
import { Collapsible } from "../ui/Collapsible";
import { IconButton } from "../ui/IconButton";
import { LinkButton } from "../ui/LinkButton";
import { Select } from "../ui/Select";
import { Spinner } from "../ui/Spinner";
import type { PackageRow } from "./model";
import { PackageIcon } from "./PackageIcon";
import { projectActions } from "./projectActions";
import { useDetails } from "./queries";

interface DetailsPanelProps {
  id: string;
  /** The package as installed in the target; absent when no project of the target has it. */
  row: PackageRow | undefined;
  /** The projects of the target. */
  projects: readonly ProjectInfo[];
  feed: string | null;
  prerelease: boolean;
  /** An operation is running: nothing can be started. */
  busy: boolean;
  onInstall(projects: readonly string[], version: string): void;
  onUpdate(projects: readonly string[], version: string): void;
  onRemove(projects: readonly string[]): void;
}

/** What is known about one package, and what can be done with it in each project of the target. */
export function DetailsPanel(props: DetailsPanelProps): ReactNode {
  const bridge = useBridge();
  const details = useDetails(props.id, props.feed, props.prerelease);
  const [chosen, setChosen] = useState<string>();
  const versions = details.data?.versions ?? [];
  // The newest version, until the user picks another one.
  const version = chosen !== undefined && versions.includes(chosen) ? chosen : versions[0];
  const actions = projectActions(props.row, props.projects, version);
  const open = (url: string): void => void bridge.host("openExternal", { url }).catch(() => {});

  const toInstall = actions.filter((action) => action.canInstall).map((action) => action.path);
  const toUpdate = actions.filter((action) => action.canUpdate).map((action) => action.path);
  const toRemove = actions.filter((action) => action.canRemove).map((action) => action.path);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      <header className="flex items-center gap-2">
        <PackageIcon url={details.data?.iconUrl} />
        <h2 className="min-w-0 truncate font-semibold">{details.data?.id ?? props.id}</h2>
        {details.isFetching ? <Spinner label="Loading the package details" /> : null}
      </header>

      {details.isError ? <p className="text-error">The details could not be loaded. {details.error.message}</p> : null}
      {details.data !== undefined && versions.length === 0 ? (
        <p className="text-muted">No enabled feed has this package, so its versions are not known.</p>
      ) : null}
      {details.data?.failures.map((failure) => (
        <p key={failure.feed} className="text-warning">
          {failure.feed}: {failure.message}
        </p>
      ))}

      <div className="flex items-center gap-2">
        <span className="font-semibold">Version</span>
        <Select
          label="Version"
          value={version ?? ""}
          disabled={versions.length === 0}
          onChange={setChosen}
          options={versions.map((item) => ({ value: item, label: item }))}
          className="flex-1"
        />
        <IconButton
          icon="add"
          label="Install in every project that does not have it"
          disabled={props.busy || toInstall.length === 0}
          onClick={() => props.onInstall(toInstall, version!)}
        />
        <IconButton
          icon="arrow-circle-up"
          label="Change to this version in every project that has it"
          disabled={props.busy || toUpdate.length === 0}
          onClick={() => props.onUpdate(toUpdate, version!)}
        />
        <IconButton
          icon="trash"
          label="Remove from every project"
          disabled={props.busy || toRemove.length === 0}
          onClick={() => props.onRemove(toRemove)}
        />
      </div>

      {details.data === undefined ? null : (
        <>
          <Collapsible title="Info" summary={details.data.description} defaultOpen={false}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {details.data.description === undefined ? null : (
                <>
                  <dt className="text-muted">Description</dt>
                  <dd>{details.data.description}</dd>
                </>
              )}
              {details.data.authors === undefined ? null : (
                <>
                  <dt className="text-muted">Authors</dt>
                  <dd>{details.data.authors}</dd>
                </>
              )}
              {details.data.license === undefined && details.data.licenseUrl === undefined ? null : (
                <>
                  <dt className="text-muted">License</dt>
                  <dd>
                    {details.data.licenseUrl === undefined ? (
                      details.data.license
                    ) : (
                      <LinkButton onClick={() => open(details.data.licenseUrl!)}>
                        {details.data.license ?? details.data.licenseUrl}
                      </LinkButton>
                    )}
                  </dd>
                </>
              )}
              {details.data.projectUrl === undefined ? null : (
                <>
                  <dt className="text-muted">Project</dt>
                  <dd>
                    <LinkButton onClick={() => open(details.data.projectUrl!)}>{details.data.projectUrl}</LinkButton>
                  </dd>
                </>
              )}
              {details.data.feed === undefined ? null : (
                <>
                  <dt className="text-muted">Feed</dt>
                  <dd>{details.data.feed}</dd>
                </>
              )}
            </dl>
          </Collapsible>
          <Collapsible
            title="Frameworks and Dependencies"
            summary={details.data.dependencyGroups.map((group) => group.framework).join(", ")}
            defaultOpen={false}
          >
            {details.data.dependencyGroups.length === 0 ? (
              <p className="text-muted">No dependencies are declared.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {details.data.dependencyGroups.map((group) => (
                  <li key={group.framework}>
                    <span className="font-semibold">{group.framework}</span>
                    {group.dependencies.length === 0 ? (
                      <span className="text-muted"> — no dependencies</span>
                    ) : (
                      <ul className="pl-4">
                        {group.dependencies.map((dependency) => (
                          <li key={dependency.id}>
                            {dependency.id} <span className="text-muted">{dependency.range}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Collapsible>
        </>
      )}

      <ul aria-label="Projects" className="flex flex-col">
        {actions.map((action) => {
          const icon = projectIconUrl(action.path);
          return (
            <li key={action.path} className="hover:bg-hover flex items-center gap-2 rounded px-1 py-0.5">
              {icon === undefined ? (
                <i className="codicon codicon-file-code text-muted" aria-hidden="true" />
              ) : (
                <img src={icon} alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{action.name}</span>
              {action.installed === undefined ? null : <span className="text-muted shrink-0">{action.installed}</span>}
              {action.installed === undefined ? (
                <IconButton
                  icon="add"
                  label={`Install in ${action.name}`}
                  disabled={props.busy || !action.canInstall}
                  onClick={() => props.onInstall([action.path], version!)}
                />
              ) : (
                <>
                  <IconButton
                    icon="arrow-circle-up"
                    label={`Change to this version in ${action.name}`}
                    disabled={props.busy || !action.canUpdate}
                    onClick={() => props.onUpdate([action.path], version!)}
                  />
                  <IconButton
                    icon="trash"
                    label={`Remove from ${action.name}`}
                    disabled={props.busy || !action.canRemove}
                    onClick={() => props.onRemove([action.path])}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the details side shows when no package is selected. */
export function NoSelection(): ReactNode {
  return <Placeholder title="No package selected">Select a package from the list to see details</Placeholder>;
}
