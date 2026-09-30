/** Public display URLs cannot carry credentials or invoke commands from feed metadata. */
export function packageMetadataUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) =>
        /token|secret|password|signature|^sig$|api.?key|credential/i.test(key),
      )
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
