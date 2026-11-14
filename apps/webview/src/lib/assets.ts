// The address of the bundle's script, read while it runs: the bundle's other files are next to it.
const script = typeof document === "undefined" ? null : (document.currentScript as HTMLScriptElement | null);
const base = script?.src ?? "";

/** The address of a file of the bundle's `assets` folder. */
export function assetUrl(name: string): string {
  return base === "" ? `assets/${name}` : new URL(`./assets/${name}`, base).toString();
}

const PROJECT_ICONS: Record<string, string> = { csproj: "csproj.svg", fsproj: "fsproj.svg", vbproj: "vbproj.svg" };

/** The icon of a project file, by its extension; undefined for a kind there is no icon for. */
export function projectIconUrl(path: string): string | undefined {
  const icon = PROJECT_ICONS[path.split(".").at(-1)?.toLowerCase() ?? ""];
  return icon === undefined ? undefined : assetUrl(icon);
}
