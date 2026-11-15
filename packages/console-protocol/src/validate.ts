import { PackageChangeKinds, type PackageChangeKind, type PackageChangeParams } from "@nuget-code/protocol";
import { ConsoleError, ConsoleErrorCodes, type ConsoleRequest, type ConsoleRequests } from "./requests";

/** The longest id, version, query, feed name or path the console may send. */
const TEXT_LIMIT = 1024;
/** The most projects, or changes, one request may name. */
const LIST_LIMIT = 1000;
/** The most packages one search may ask for, as in the view. */
const TAKE_LIMIT = 100;

type Fields = Readonly<Record<string, unknown>>;
type Check<M extends ConsoleRequest> = (fields: Fields) => ConsoleRequests[M]["params"];

function invalid(message: string): ConsoleError {
  return new ConsoleError(ConsoleErrorCodes.invalidParams, message);
}

function text(fields: Fields, name: string): string {
  const value = fields[name];
  if (typeof value !== "string" || value === "" || value.length > TEXT_LIMIT) {
    throw invalid(`'${name}' must be a non-empty string.`);
  }

  return value;
}

function optionalText(fields: Fields, name: string): string | undefined {
  return fields[name] === undefined || fields[name] === null ? undefined : text(fields, name);
}

function flag(fields: Fields, name: string): boolean {
  const value = fields[name];
  if (value !== undefined && typeof value !== "boolean") {
    throw invalid(`'${name}' must be true or false.`);
  }

  return value === true;
}

function count(fields: Fields, name: string, fallback: number, limit: number): number {
  const value = fields[name] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > limit) {
    throw invalid(`'${name}' must be a whole number from 0 to ${limit}.`);
  }

  return value;
}

function projects(fields: Fields, name = "projects"): string[] {
  const value = fields[name];
  if (!Array.isArray(value) || value.length === 0 || value.length > LIST_LIMIT) {
    throw invalid(`'${name}' must name at least one project.`);
  }

  return value.map((path, index) => text({ [`${name}[${index}]`]: path }, `${name}[${index}]`));
}

function isChangeKind(value: unknown): value is PackageChangeKind {
  return typeof value === "string" && Object.hasOwn(PackageChangeKinds, value);
}

function changes(fields: Fields): PackageChangeParams[] {
  const value = fields.changes;
  if (!Array.isArray(value) || value.length === 0 || value.length > LIST_LIMIT) {
    throw invalid("'changes' must have at least one change.");
  }

  return value.map((item: unknown) => {
    const change: Fields = typeof item === "object" && item !== null ? (item as Fields) : {};
    if (!isChangeKind(change.kind)) {
      throw invalid("The 'kind' of a change must be install, update or remove.");
    }

    const version = optionalText(change, "version");
    if (version === undefined && change.kind !== PackageChangeKinds.remove) {
      throw invalid("A change that installs or updates must have a 'version'.");
    }

    return {
      kind: change.kind,
      id: text(change, "id"),
      projects: projects(change),
      ...(version === undefined ? {} : { version })
    };
  });
}

function withOptional<T extends object, K extends string>(value: T, name: K, text: string | undefined) {
  return text === undefined ? value : { ...value, [name]: text };
}

const checks: { readonly [M in ConsoleRequest]: Check<M> } = {
  projects: () => ({}),
  pickProject: (fields) => withOptional({}, "current", optionalText(fields, "current")),
  installed: () => ({}),
  updates: (fields) => ({ prerelease: flag(fields, "prerelease"), transitive: flag(fields, "transitive") }),
  search: (fields) =>
    withOptional(
      withOptional(
        {
          prerelease: flag(fields, "prerelease"),
          skip: count(fields, "skip", 0, Number.MAX_SAFE_INTEGER),
          take: count(fields, "take", 20, TAKE_LIMIT)
        },
        "query",
        optionalText(fields, "query")
      ),
      "feed",
      optionalText(fields, "feed")
    ),
  details: (fields) =>
    withOptional(
      { id: text(fields, "id"), prerelease: flag(fields, "prerelease") },
      "feed",
      optionalText(fields, "feed")
    ),
  vulnerabilities: () => ({}),
  plan: (fields) => ({ changes: changes(fields) }),
  install: (fields) => ({ id: text(fields, "id"), version: text(fields, "version"), projects: projects(fields) }),
  update: (fields) => ({ changes: changes(fields) }),
  remove: (fields) => ({ id: text(fields, "id"), projects: projects(fields) }),
  restore: (fields) =>
    fields.projects === undefined || fields.projects === null
      ? { force: flag(fields, "force") }
      : { force: flag(fields, "force"), projects: projects(fields) },
  sources: () => ({}),
  cancel: () => ({})
};

/**
 * The params of a request, checked and reduced to the fields the request has. They come from another
 * process, so nothing in them is taken on trust. Throws a `ConsoleError` that says what is wrong.
 */
export function validate<M extends ConsoleRequest>(method: M, params: unknown): ConsoleRequests[M]["params"] {
  const fields: Fields =
    typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Fields) : {};
  return (checks[method] as Check<M>)(fields);
}
