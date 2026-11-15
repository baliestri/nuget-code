const UNITS = ["KB", "MB", "GB", "TB"] as const;

/** A size for people: bytes as they are, anything larger with one decimal, in units of 1024. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.floor(Number.isFinite(bytes) ? bytes : 0))} B`;
  }

  let value = bytes / 1024;
  let unit = 0;
  // Compared after rounding, so that 1023.96 KB is shown as 1.0 MB and never as 1024.0 KB.
  while (Number(value.toFixed(1)) >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(1)} ${UNITS[unit]}`;
}
