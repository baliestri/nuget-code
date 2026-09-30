import { parseXml, XmlElement } from "@rgrove/parse-xml";
import type { PackageFeed, SourceEdit } from "#contracts";

const elements = (node: XmlElement) =>
  node.children.filter(
    (child): child is XmlElement => child instanceof XmlElement,
  );
const hasControlCharacters = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32);
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const span = (node: XmlElement) => {
  if (node.start === undefined || node.end === undefined)
    throw new Error("XML source positions are unavailable.");
  return { start: node.start, end: node.end };
};
export const credentialSourceName = (name: string) =>
  name.replace(/_x([0-9a-f]{4})_/gi, (_, code: string) =>
    String.fromCharCode(parseInt(code, 16)),
  );

/** Edit selected nodes only; unrelated XML, including credentials, stays intact. */
export function editPackageSource(
  text: string,
  edit: SourceEdit,
  effectiveFeeds?: readonly PackageFeed[],
): string {
  if (
    !edit.name.trim() ||
    edit.name !== edit.name.trim() ||
    hasControlCharacters(edit.name)
  )
    throw new Error(
      "Enter a non-empty source name without control characters.",
    );
  if (edit.action !== "remove") {
    if (
      !edit.url.trim() ||
      edit.url !== edit.url.trim() ||
      hasControlCharacters(edit.url)
    )
      throw new Error(
        "Enter a source URL or folder path without surrounding whitespace.",
      );
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(edit.url) &&
      !/^[a-z]:[\\/]/i.test(edit.url)
    ) {
      const url = new URL(edit.url);
      if (
        !["https:", "http:", "file:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        (url.protocol !== "file:" && !/^https?:\/\//i.test(edit.url))
      )
        throw new Error(
          "Use an HTTP(S) URL without embedded credentials or a local folder.",
        );
    }
  }
  let result = text;
  const original = edit.originalName ?? edit.name;
  const root = parseXml(result, { includeOffsets: true }).root;
  if (!root || root.name !== "configuration")
    throw new Error("Expected a NuGet configuration document.");
  if (
    effectiveFeeds &&
    new Set(effectiveFeeds.map((feed) => feed.name)).size !==
      effectiveFeeds.length
  )
    throw new Error(
      "Effective sources have conflicting names across projects. Select a concrete config to edit.",
    );
  if (
    effectiveFeeds?.some(
      (feed) =>
        feed.name === edit.name &&
        (!edit.originalName || original !== edit.name),
    )
  )
    throw new Error("A source with this name already exists.");
  if (edit.action === "remove" || original !== edit.name) {
    for (const section of elements(root).filter((node) =>
      ["packageSourceCredentials", "packageSourceMapping"].includes(node.name),
    )) {
      if (
        elements(section).some(
          (node) =>
            credentialSourceName(node.name) === original ||
            node.attributes.key === original,
        )
      )
        throw new Error(
          "This source has credentials or package source mappings. Adjust those references in the config before renaming or removing it.",
        );
    }
  }
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const declarations = elements(root)
    .filter((node) => node.name === "packageSources")
    .flatMap(elements)
    .filter((node) => node.name === "add");
  const names = declarations.map((node) => node.attributes.key);
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate source names must be resolved before editing.");
  const existing = declarations.find(
    (node) => node.attributes.key === original,
  );
  const inherited = effectiveFeeds?.find((feed) => feed.name === original);
  const entry = (
    feed: Pick<
      PackageFeed,
      "name" | "url" | "allowInsecure" | "sourceAttributes"
    >,
  ) => {
    const attributes = {
      ...feed.sourceAttributes,
      key: feed.name,
      value: feed.url,
      allowInsecureConnections: String(!!feed.allowInsecure),
    };
    return `<add ${Object.entries(attributes)
      .map(([key, value]) => `${key}="${escape(value)}"`)
      .join(" ")} />`;
  };
  function append(nodeText: string, name: string, insertion: string): string {
    const close = nodeText.lastIndexOf(`</${name}>`);
    return close < 0
      ? nodeText.replace(/\/\s*>$/, `>${insertion}</${name}>`)
      : nodeText.slice(0, close) + insertion + nodeText.slice(close);
  }
  function update(
    sectionName: string,
    keys: string[],
    additions: string[],
    clear = false,
  ) {
    const current = parseXml(result, { includeOffsets: true }).root!;
    const sections = elements(current).filter(
      (node) => node.name === sectionName,
    );
    if (sections.length > 1)
      throw new Error(
        `Multiple ${sectionName} sections must be resolved before editing.`,
      );
    const section = sections[0];
    if (!section) {
      if (!additions.length) return;
      const insertion = `${newline}  <${sectionName}>${newline}${additions.map((value) => `    ${value}`).join(newline)}${newline}  </${sectionName}>${newline}`;
      const bounds = span(current);
      result =
        result.slice(0, bounds.start) +
        append(
          result.slice(bounds.start, bounds.end),
          "configuration",
          insertion,
        ) +
        result.slice(bounds.end);
      return;
    }
    const children = elements(section);
    if (
      !clear &&
      edit.action === "upsert" &&
      sectionName === "packageSources" &&
      children.some(
        (node) =>
          node.name === "add" &&
          node.attributes.key === edit.name &&
          (!edit.originalName || edit.name !== original),
      )
    )
      throw new Error(
        "A source with this name already exists in the destination.",
      );
    const removals = children.filter((node) =>
      clear
        ? ["add", "clear", "remove"].includes(node.name)
        : ["add", "remove"].includes(node.name) &&
          keys.includes(node.attributes.key ?? ""),
    );
    const bounds = span(section);
    let sectionText = result.slice(bounds.start, bounds.end);
    for (const child of removals.sort((a, b) => b.start! - a.start!)) {
      const where = span(child);
      sectionText =
        sectionText.slice(0, where.start - bounds.start) +
        sectionText.slice(where.end - bounds.start);
    }
    if (additions.length)
      sectionText = append(
        sectionText,
        sectionName,
        `${newline}${additions.map((value) => `    ${value}`).join(newline)}${newline}  `,
      );
    result =
      result.slice(0, bounds.start) + sectionText + result.slice(bounds.end);
  }
  const replacement = {
    ...edit,
    sourceAttributes: existing?.attributes ?? inherited?.sourceAttributes,
  };
  if (effectiveFeeds && (edit.action === "remove" || original !== edit.name)) {
    const remaining: Array<
      Pick<
        PackageFeed,
        "name" | "url" | "enabled" | "allowInsecure" | "sourceAttributes"
      >
    > = effectiveFeeds.filter((feed) => feed.name !== original);
    if (edit.action !== "remove") remaining.push(replacement);
    update("packageSources", [], ["<clear />", ...remaining.map(entry)], true);
    update(
      "disabledPackageSources",
      [],
      [
        "<clear />",
        ...remaining
          .filter((feed) => !feed.enabled)
          .map((feed) => `<add key="${escape(feed.name)}" value="true" />`),
      ],
      true,
    );
  } else {
    update(
      "packageSources",
      [original],
      edit.action === "remove" ? [] : [entry(replacement)],
    );
    if (effectiveFeeds && edit.enabled && edit.action !== "remove") {
      update(
        "disabledPackageSources",
        [],
        [
          "<clear />",
          ...effectiveFeeds
            .filter((feed) => feed.name !== original && !feed.enabled)
            .map((feed) => `<add key="${escape(feed.name)}" value="true" />`),
        ],
        true,
      );
    } else {
      update(
        "disabledPackageSources",
        [original, edit.name],
        edit.action === "remove" || edit.enabled
          ? []
          : [`<add key="${escape(edit.name)}" value="true" />`],
      );
    }
  }
  parseXml(result);
  return result;
}
