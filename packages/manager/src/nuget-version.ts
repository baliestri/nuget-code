/** Parsed concrete version; normalized follows NuGet's metadata-free format. */
export interface ParsedNuGetVersion {
  numbers: readonly [number, number, number, number];
  prerelease: readonly string[];
  normalized: string;
}

const maxComponent = 2_147_483_647;
// .NET Char.IsWhiteSpace differs from JavaScript trim (notably NEL and BOM).
const whitespace =
  "[\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const surroundingWhitespace = new RegExp(
  `^${whitespace}+|${whitespace}+$`,
  "g",
);

function trimWhitespace(value: string): string {
  return value.replace(surroundingWhitespace, "");
}

function validLabel(value: string, allowLeadingZeros: boolean): boolean {
  return (
    value.length > 0 &&
    !/[^0-9a-z-]/i.test(value) &&
    (allowLeadingZeros || !/^0[0-9]+$/.test(value))
  );
}

export function parseNuGetVersion(
  value: string,
): ParsedNuGetVersion | undefined {
  const input = trimWhitespace(value);
  const plus = input.indexOf("+");
  const version = plus < 0 ? input : input.slice(0, plus);
  if (
    plus >= 0 &&
    !input
      .slice(plus + 1)
      .split(".")
      .every((part) => validLabel(part, true))
  ) {
    return undefined;
  }

  const dash = version.indexOf("-");
  const core = dash < 0 ? version : version.slice(0, dash);
  const prerelease = dash < 0 ? [] : version.slice(dash + 1).split(".");
  if (!prerelease.every((part) => validLabel(part, false))) {
    return undefined;
  }

  const components = core.split(".");
  if (components.length > 4) {
    return undefined;
  }
  const numbers: [number, number, number, number] = [0, 0, 0, 0];
  for (const [index, component] of components.entries()) {
    const text = trimWhitespace(component);
    const number = Number(text);
    if (!/^[0-9]+$/.test(text) || number > maxComponent) {
      return undefined;
    }
    numbers[index] = number;
  }

  const normalizedCore = numbers.slice(0, numbers[3] === 0 ? 3 : 4).join(".");
  return {
    numbers,
    prerelease,
    normalized:
      normalizedCore +
      (prerelease.length > 0 ? `-${prerelease.join(".")}` : ""),
  };
}

function compareValues(a: number | string, b: number | string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function releaseNumber(label: string): number | undefined {
  const number = Number(label);
  // NuGet VersionRelease uses Int32.TryParse, including signed legacy labels.
  // Numeric-looking identifiers outside this range are compared as text.
  return /^-?[0-9]+$/.test(label) &&
    number >= -2_147_483_648 &&
    number <= maxComponent
    ? number
    : undefined;
}

export function compareNuGetVersions(a: string, b: string): number {
  const left = parseNuGetVersion(a);
  const right = parseNuGetVersion(b);
  if (!left || !right) {
    throw new RangeError("Cannot compare an invalid concrete NuGet version.");
  }

  for (const [index, value] of left.numbers.entries()) {
    const order = compareValues(value, right.numbers[index]!);
    if (order !== 0) return order;
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return compareValues(
      Number(left.prerelease.length === 0),
      Number(right.prerelease.length === 0),
    );
  }

  const count = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index++) {
    const aLabel = left.prerelease[index]!;
    const bLabel = right.prerelease[index]!;
    const aNumber = releaseNumber(aLabel);
    const bNumber = releaseNumber(bLabel);
    let order: number;
    if (aNumber !== undefined && bNumber !== undefined) {
      order = compareValues(aNumber, bNumber);
    } else if (aNumber !== undefined || bNumber !== undefined) {
      order = aNumber !== undefined ? -1 : 1;
    } else {
      order = compareValues(aLabel.toUpperCase(), bLabel.toUpperCase());
    }
    if (order !== 0) return order;
  }

  return compareValues(left.prerelease.length, right.prerelease.length);
}

export function sameNuGetVersion(a: string, b: string): boolean {
  return compareNuGetVersions(a, b) === 0;
}
