/**
 * A path as the system writes it. The editor hands out Windows paths with the drive letter in lower case
 * (`d:\work`), and everything derived from them, such as the folders NuGet reports, would carry it. Every
 * path that goes from the editor to the backend passes through here, so that they all agree.
 */
export function systemPath(path: string, platform: string): string {
  return platform === "win32" && /^[a-z]:/.test(path) ? path[0]!.toUpperCase() + path.slice(1) : path;
}
