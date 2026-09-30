import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import { normalizeCatalogFeedUrl } from "#manager";
import { ProjectContextError } from "#client/project-context";

const elements = (node: XmlElement) =>
  node.children.filter(
    (child): child is XmlElement => child instanceof XmlElement,
  );
export function sourceIdentity(value: string): string {
  if (/^https?:\/\//i.test(value))
    return normalizeCatalogFeedUrl(value) ?? value;
  const file = value.startsWith("file:") ? fileURLToPath(value) : value;
  const normalized = path.resolve(file);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function fail(): never {
  throw new ProjectContextError(
    "unsupported-context",
    "The target package source restriction could not be proven.",
  );
}
function serialize(node: XmlElement): string {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return `<${node.name}${Object.entries(node.attributes)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join(
      "",
    )}>${node.children.map((child) => (child instanceof XmlElement ? serialize(child) : "text" in child ? escape(String(child.text)) : "")).join("")}</${node.name}>`;
}

/** Preserve dependency mappings; intersect only the target's highest-precedence rules. */
export function restrictCompatibilitySources(
  text: string,
  packageId: string,
  authorized: readonly string[],
  targetSources: readonly string[],
): string {
  if (!/^[a-z0-9_.-]+$/i.test(packageId)) fail();
  const root = parseXml(text).root;
  if (!root || root.name !== "configuration") fail();
  const children = elements(root);
  if (
    children.filter((child) => child.name === "packageSources").length !== 1 ||
    children.filter((child) => child.name === "packageSourceMapping").length > 1
  )
    fail();
  // Fallback stores and alternative restore source properties need their own provenance proof.
  if (
    children.some(
      (child) =>
        child.name === "fallbackPackageFolders" &&
        elements(child).some((item) => item.name !== "clear"),
    )
  )
    fail();
  const disabled = new Set(
    children
      .filter((child) => child.name === "disabledPackageSources")
      .flatMap(elements)
      .filter(
        (child) =>
          child.name === "add" &&
          child.attributes.value?.toLowerCase() === "true",
      )
      .map((child) => child.attributes.key?.toLowerCase()),
  );
  const sources = elements(
    children.find((child) => child.name === "packageSources")!,
  ).filter(
    (item) =>
      item.name === "add" && !disabled.has(item.attributes.key?.toLowerCase()),
  );
  const allowed = new Set(authorized.map(sourceIdentity));
  const target = new Set(targetSources.map(sourceIdentity));
  if (
    !sources.length ||
    !target.size ||
    [...target].some((value) => !allowed.has(value))
  )
    fail();
  if (
    sources.some(
      (source) =>
        !source.attributes.key ||
        !source.attributes.value ||
        !allowed.has(sourceIdentity(source.attributes.value)),
    )
  )
    fail();
  if (
    new Set(sources.map((source) => source.attributes.key!.toLowerCase()))
      .size !== sources.length
  )
    fail();
  let mapping = children.find((child) => child.name === "packageSourceMapping");
  const existing = mapping ? elements(mapping) : [];
  const packageKey = packageId.toLowerCase();
  const rank = (pattern: string) => {
    const value = pattern.toLowerCase();
    if (value === packageKey) return Number.MAX_SAFE_INTEGER;
    if (value === "*") return 0;
    if (
      /^[a-z0-9_.-]+\*$/i.test(value) &&
      packageKey.startsWith(value.slice(0, -1))
    )
      return value.length;
    return -1;
  };
  if (
    existing.some(
      (entry) =>
        entry.name !== "packageSource" ||
        !entry.attributes.key ||
        elements(entry).some(
          (rule) =>
            rule.name !== "package" ||
            !/^[a-z0-9_.-]+\*?$|^\*$/i.test(rule.attributes.pattern ?? ""),
        ),
    )
  )
    fail();
  const scores = sources.map((source) => {
    const rules = existing
      .filter(
        (entry) =>
          entry.attributes.key?.toLowerCase() ===
          source.attributes.key!.toLowerCase(),
      )
      .flatMap(elements);
    return {
      source,
      score: mapping
        ? Math.max(-1, ...rules.map((rule) => rank(rule.attributes.pattern!)))
        : 0,
    };
  });
  const highest = Math.max(...scores.map((entry) => entry.score));
  const eligible = scores.filter(
    ({ source, score }) =>
      score >= 0 &&
      score === highest &&
      target.has(sourceIdentity(source.attributes.value!)),
  );
  if (!eligible.length) fail();
  if (!mapping) {
    mapping = new XmlElement("packageSourceMapping");
    for (const source of sources) {
      const entry = new XmlElement("packageSource", {
        key: source.attributes.key!,
      });
      entry.children.push(new XmlElement("package", { pattern: "*" }));
      mapping.children.push(entry);
    }
    root.children.push(mapping);
  }
  for (const entry of elements(mapping))
    entry.children = entry.children.filter(
      (child) =>
        !(
          child instanceof XmlElement &&
          child.attributes.pattern?.toLowerCase() === packageKey
        ),
    );
  for (const { source } of eligible) {
    const entry = elements(mapping).find(
      (item) =>
        item.attributes.key?.toLowerCase() ===
        source.attributes.key!.toLowerCase(),
    );
    if (!entry) fail();
    entry.children.push(new XmlElement("package", { pattern: packageId }));
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n${serialize(root)}\n`;
}
