export function parseReleaseVersion(value: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error("Expected a stable X.Y.Z version.");
  return value;
}

export function assertVersionIncreases(next: string, previous: string): void {
  const a = parseReleaseVersion(next).split(".").map(BigInt);
  const b = parseReleaseVersion(previous).split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return;
    if (a[i]! < b[i]!) break;
  }
  throw new Error(
    "Release version must be greater than the current extension version.",
  );
}
