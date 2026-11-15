/** A NuGet version: up to four numbers and an optional pre-release label. Build metadata is not kept. */
export interface NuGetVersion {
  numbers: readonly [number, number, number, number];
  /** The dot-separated identifiers of the pre-release label; empty for a release. */
  prerelease: readonly string[];
}

const PATTERN =
  /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]*)?$/;

/** Reads one version. Ranges and floating versions (`1.*`, `[1.0,2.0)`) are not versions: `undefined`. */
export function parseVersion(text: string): NuGetVersion | undefined {
  const match = PATTERN.exec(text.trim());
  if (match === null) {
    return undefined;
  }

  const number = (index: number): number => Number(match[index] ?? 0);
  return {
    numbers: [number(1), number(2), number(3), number(4)],
    prerelease: match[5] === undefined ? [] : match[5].split(".")
  };
}

/** Negative when `left` is the older version, positive when it is the newer one, zero when they are the same. */
export function compareVersions(left: NuGetVersion, right: NuGetVersion): number {
  for (let index = 0; index < 4; index++) {
    const difference = left.numbers[index]! - right.numbers[index]!;
    if (difference !== 0) {
      return difference;
    }
  }

  // A release is newer than any of its pre-releases.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }

  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index++) {
    const difference = compareIdentifiers(left.prerelease[index]!, right.prerelease[index]!);
    if (difference !== 0) {
      return difference;
    }
  }

  return left.prerelease.length - right.prerelease.length;
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }

  // A numeric identifier is older than an alphanumeric one.
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }

  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders version texts, oldest first. Texts that are not versions come before every version, in
 * alphabetical order, so a list that mixes both still has one stable order.
 */
export function compareVersionTexts(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a !== undefined && b !== undefined) {
    return compareVersions(a, b);
  }

  if (a === undefined && b === undefined) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  return a === undefined ? -1 : 1;
}

export function isPrerelease(text: string): boolean {
  return (parseVersion(text)?.prerelease.length ?? 0) > 0;
}

/** The newest of the texts that are versions; `undefined` when none is. */
export function newestVersion(texts: Iterable<string>): string | undefined {
  let newest: { text: string; version: NuGetVersion } | undefined;
  for (const text of texts) {
    const version = parseVersion(text);
    if (version !== undefined && (newest === undefined || compareVersions(version, newest.version) > 0)) {
      newest = { text, version };
    }
  }

  return newest?.text;
}

/** Whether `candidate` is a version newer than `current`. False when either is not a version. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return a !== undefined && b !== undefined && compareVersions(a, b) > 0;
}
