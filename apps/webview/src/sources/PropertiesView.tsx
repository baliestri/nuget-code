import { SourceProperties, type SourceProperty } from "@nuget-code/protocol";
import { useId, useState, type ReactNode } from "react";
import { IconButton } from "../ui/IconButton";

interface PropertyProps {
  label: string;
  /** What the selected file declares; empty when it declares nothing. */
  declared: string;
  /** What NuGet ends up using, every file considered. */
  resolved: string | undefined;
  readOnly: boolean;
  /** Sets the value; an empty one removes the declaration. */
  onSet(value: string): void;
  /** Lets the user choose a folder; undefined when they give up. */
  onPick(): Promise<string | undefined>;
}

function Property({ label, declared, resolved, readOnly, onSet, onPick }: PropertyProps): ReactNode {
  const id = useId();
  const [draft, setDraft] = useState(declared);
  const commit = (): void => {
    if (draft.trim() !== declared) {
      onSet(draft.trim());
    }
  };

  return (
    <div className="grid grid-cols-[11rem_1fr] items-center gap-x-3 gap-y-1">
      <label htmlFor={id}>{label}:</label>
      <div className="border-input-border bg-input flex min-w-0 items-center rounded border">
        <input
          id={id}
          value={draft}
          readOnly={readOnly}
          spellCheck={false}
          aria-describedby={`${id}-resolved`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            }
          }}
          className="text-input-fg min-w-0 flex-1 bg-transparent px-1.5 py-0.5 outline-none read-only:opacity-70"
        />
        <IconButton
          icon="folder"
          label={`Choose: ${label}`}
          disabled={readOnly}
          onClick={() =>
            void onPick().then(
              (path) => {
                if (path !== undefined) {
                  setDraft(path);
                  onSet(path);
                }
              },
              () => {}
            )
          }
        />
      </div>
      <span />
      <span id={`${id}-resolved`} className="text-muted break-all">
        {resolved ?? "Not set"}
      </span>
    </div>
  );
}

interface PropertiesViewProps {
  /** The values the selected file declares; none in the effective view. */
  globalPackagesFolder: string | undefined;
  repositoryPath: string | undefined;
  resolvedGlobalPackagesFolder: string;
  resolvedLocalPackagesFolder: string | undefined;
  readOnly: boolean;
  onSet(property: SourceProperty, value: string): void;
  onPick(title: string): Promise<string | undefined>;
}

/** The folders a NuGet.config can move: where packages are restored to, and the folder of packages.config projects. */
export function PropertiesView(props: PropertiesViewProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 p-2">
      <Property
        // A value written elsewhere, or another file selected, starts the field over.
        key={`global/${props.globalPackagesFolder ?? ""}`}
        label="Global packages folder"
        declared={props.globalPackagesFolder ?? ""}
        resolved={props.resolvedGlobalPackagesFolder}
        readOnly={props.readOnly}
        onSet={(value) => props.onSet(SourceProperties.globalPackagesFolder, value)}
        onPick={() => props.onPick("Global packages folder")}
      />
      <Property
        key={`local/${props.repositoryPath ?? ""}`}
        label="Local packages folder"
        declared={props.repositoryPath ?? ""}
        resolved={props.resolvedLocalPackagesFolder}
        readOnly={props.readOnly}
        onSet={(value) => props.onSet(SourceProperties.repositoryPath, value)}
        onPick={() => props.onPick("Local packages folder")}
      />
    </div>
  );
}
