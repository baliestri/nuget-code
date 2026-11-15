import type { FeedInfo } from "@nuget-code/protocol";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";

/** What the dialog collects. The user and the password are for the editor's secret storage, not for the file. */
export interface FeedValues {
  name: string;
  source: string;
  username: string;
  password: string;
  enabled: boolean;
  allowInsecureConnections: boolean;
  disableTlsCertificateValidation: boolean;
}

interface FeedDialogProps {
  /** The feed being edited; absent for a new one. */
  feed: FeedInfo | undefined;
  /** Writes the feed. A rejection is shown in the dialog, which stays open. */
  onSave(values: FeedValues): Promise<void>;
  onClose(): void;
}

const isWebAddress = (source: string): boolean => /^https?:\/\//i.test(source);

/** Why the values cannot be sent yet; undefined when they can. */
export function validateFeed(values: FeedValues): string | undefined {
  if (values.name.trim() === "") {
    return "A name is needed.";
  }

  if (values.source.trim() === "") {
    return "A URL or a folder is needed.";
  }

  if ((values.username === "") !== (values.password === "")) {
    return "Give both the user and the password, or neither.";
  }

  if (values.username !== "" && !isWebAddress(values.source.trim())) {
    return "Credentials can only be saved for an http or https source.";
  }

  return undefined;
}

function Field(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: "text" | "password";
  autoFocus?: boolean;
}): ReactNode {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{props.label}:</label>
      <input
        id={id}
        type={props.type ?? "text"}
        value={props.value}
        autoFocus={props.autoFocus}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => props.onChange(event.target.value)}
        className="border-input-border bg-input text-input-fg min-w-0 rounded border px-1.5 py-0.5"
      />
    </>
  );
}

/** Adds a feed or edits one. */
export function FeedDialog({ feed, onSave, onClose }: FeedDialogProps): ReactNode {
  const [values, setValues] = useState<FeedValues>({
    name: feed?.name ?? "",
    source: feed?.source ?? "https://",
    username: "",
    password: "",
    enabled: feed?.enabled ?? true,
    allowInsecureConnections: feed?.allowInsecureConnections ?? false,
    disableTlsCertificateValidation: feed?.disableTlsCertificateValidation ?? false
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<FeedValues>): void => setValues((current) => ({ ...current, ...patch }));
  const invalid = validateFeed(values);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (invalid !== undefined || saving) {
      return;
    }

    setSaving(true);
    setError(undefined);
    onSave({ ...values, name: values.name.trim(), source: values.source.trim() }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    });
  };

  return (
    <Dialog title={feed === undefined ? "New feed" : `Editing: ${feed.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
          <Field label="Name" value={values.name} onChange={(name) => set({ name })} autoFocus />
          <Field label="URL" value={values.source} onChange={(source) => set({ source })} />
          <Field label="User" value={values.username} onChange={(username) => set({ username })} />
          <Field label="Password" type="password" value={values.password} onChange={(password) => set({ password })} />
        </div>
        <Checkbox checked={values.enabled} onChange={(enabled) => set({ enabled })}>
          Enabled
        </Checkbox>
        <Checkbox
          checked={values.allowInsecureConnections}
          onChange={(allowInsecureConnections) => set({ allowInsecureConnections })}
        >
          Allow insecure connections
        </Checkbox>
        <Checkbox
          checked={values.disableTlsCertificateValidation}
          onChange={(disableTlsCertificateValidation) => set({ disableTlsCertificateValidation })}
        >
          Disable TLS certificate validation
        </Checkbox>
        <Banner kind="info">
          Credentials will be saved to VS Code, not to the NuGet.config. Leaving them empty keeps what is saved.
        </Banner>
        {error === undefined ? null : <Banner kind="error">{error}</Banner>}
        <div className="flex items-center justify-end gap-2">
          {invalid === undefined ? null : <span className="text-muted min-w-0 flex-1">{invalid}</span>}
          <Button type="submit" disabled={invalid !== undefined || saving}>
            OK
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
