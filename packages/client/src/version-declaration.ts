import { parseXml, XmlElement, XmlText } from "@rgrove/parse-xml";
import type { VersionDeclarationChange, VersionTextEdit } from "#contracts";
import { parseNuGetVersion, sameNuGetVersion } from "#manager";
import { VersionEditError } from "#client/version-edit-error";

function localName(element: XmlElement): string {
  return element.name.split(":").at(-1)!;
}
function children(element: XmlElement): XmlElement[] {
  return element.children.filter(
    (node): node is XmlElement => node instanceof XmlElement,
  );
}
function descendants(element: XmlElement): XmlElement[] {
  return [element, ...children(element).flatMap(descendants)];
}
function supportedNamespace(element: XmlElement): boolean {
  const prefix = element.name.includes(":")
    ? element.name.split(":")[0]
    : undefined;
  const attribute = prefix ? `xmlns:${prefix}` : "xmlns";
  let current: XmlElement | null = element;
  while (current) {
    const namespace = current.attributes[attribute];
    if (namespace !== undefined)
      return (
        namespace === "" ||
        namespace === "http://schemas.microsoft.com/developer/msbuild/2003"
      );
    current = current.parent instanceof XmlElement ? current.parent : null;
  }
  return prefix === undefined;
}
function staticItem(element: XmlElement): boolean {
  if (
    !(element.parent instanceof XmlElement) ||
    localName(element.parent) !== "ItemGroup"
  )
    return false;
  let current: XmlElement | null = element;
  while (current) {
    if (!supportedNamespace(current)) return false;
    if (
      current !== element &&
      !["Project", "ItemGroup", "Choose", "When", "Otherwise"].includes(
        localName(current),
      )
    )
      return false;
    current = current.parent instanceof XmlElement ? current.parent : null;
  }
  return true;
}
function openingTag(text: string, start: number): string {
  let quote: string | undefined;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return text.slice(start, index + 1);
  }
  throw new VersionEditError("invalid-xml", "Unterminated declaration tag.");
}
function literalEdit(
  text: string,
  start: number,
  end: number,
  replacementText: string,
): VersionTextEdit {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > text.length ||
    end <= start
  ) {
    throw new VersionEditError(
      "unsupported-declaration",
      "Version source offsets are unavailable.",
    );
  }
  const raw = text.slice(start, end);
  const leading = /^\s*/u.exec(raw)![0].length;
  const trailing = /\s*$/u.exec(raw)![0].length;
  const from = start + leading;
  const to = end - trailing;
  if (to <= from)
    throw new VersionEditError(
      "unsupported-declaration",
      "A concrete version literal is required.",
    );
  return Object.freeze({
    start: from,
    end: to,
    expectedText: text.slice(from, to),
    replacementText,
  });
}

/** Select by parsed XML identity, then edit only the original literal's text span. */
export function planVersionDeclaration(
  text: string,
  change: VersionDeclarationChange,
): VersionTextEdit | undefined {
  const candidate = parseNuGetVersion(change.version);
  if (!candidate || !parseNuGetVersion(change.expectedVersion))
    throw new VersionEditError(
      "invalid-version",
      "A concrete source and candidate version are required.",
    );
  let document: ReturnType<typeof parseXml>;
  try {
    document = parseXml(text, {
      includeOffsets: true,
      preserveComments: true,
      preserveCdata: true,
      preserveDocumentType: true,
    });
  } catch (cause) {
    throw new VersionEditError(
      "invalid-xml",
      "The declaration document is not valid XML.",
      { cause },
    );
  }
  const root = document.root;
  if (
    !root ||
    localName(root) !== "Project" ||
    !supportedNamespace(root) ||
    document.children.some((node) => node.type === "doctype")
  ) {
    throw new VersionEditError(
      "unsupported-declaration",
      "An ordinary MSBuild Project document is required.",
    );
  }
  const matches = descendants(root).filter(
    (element) =>
      localName(element) === change.kind &&
      [
        element.attributes.Include,
        element.attributes.Update,
        element.attributes.Remove,
      ].some((id) => id?.toLowerCase() === change.packageId.toLowerCase()),
  );
  if (matches.length > 1)
    throw new VersionEditError(
      "ambiguous-declaration",
      "Multiple package declarations require explicit disambiguation.",
    );
  const element = matches[0];
  if (
    !element ||
    !staticItem(element) ||
    element.attributes.Include?.toLowerCase() !==
      change.packageId.toLowerCase() ||
    element.attributes.Update !== undefined ||
    element.attributes.Remove !== undefined ||
    element.attributes.VersionOverride !== undefined ||
    children(element).some((child) => localName(child) === "VersionOverride")
  ) {
    throw new VersionEditError(
      "unsupported-declaration",
      "The package must have one static Include declaration without overrides.",
    );
  }
  const versionElements = children(element).filter(
    (child) => localName(child) === "Version",
  );
  const attributeVersion = element.attributes.Version;
  if (
    versionElements.length > 1 ||
    (attributeVersion !== undefined && versionElements.length !== 0)
  ) {
    throw new VersionEditError(
      "ambiguous-declaration",
      "The declaration contains multiple version values.",
    );
  }
  const versionElement = versionElements[0];
  const value = attributeVersion ?? versionElement?.text;
  if (!value || !parseNuGetVersion(value))
    throw new VersionEditError(
      "unsupported-declaration",
      "Expressions and ranges cannot be edited as literals.",
    );
  if (!sameNuGetVersion(value, change.expectedVersion))
    throw new VersionEditError(
      "source-version-mismatch",
      "The declared version differs from the evaluated intent.",
    );
  const finish = (edit: VersionTextEdit): VersionTextEdit | undefined =>
    sameNuGetVersion(value, candidate.normalized) ? undefined : edit;

  if (attributeVersion !== undefined) {
    const tag = openingTag(text, element.start);
    // Tokenize attributes, consuming whole quoted values (including conditions containing '>').
    for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
      if (match[1] !== "Version") continue;
      const quoted = match[2]!;
      const start =
        element.start + match.index + match[0].length - quoted.length + 1;
      return finish(
        literalEdit(
          text,
          start,
          start + quoted.length - 2,
          candidate.normalized,
        ),
      );
    }
  } else if (versionElement && supportedNamespace(versionElement)) {
    const values = versionElement.children.filter(
      (node): node is XmlText => node instanceof XmlText,
    );
    if (
      values.length === 1 &&
      versionElement.children.every(
        (node) =>
          node instanceof XmlText ||
          node.type === "comment" ||
          node.type === "pi",
      )
    ) {
      return finish(
        literalEdit(
          text,
          values[0]!.start,
          values[0]!.end,
          candidate.normalized,
        ),
      );
    }
  }
  throw new VersionEditError(
    "unsupported-declaration",
    "The version literal cannot be changed without rewriting its structure.",
  );
}
