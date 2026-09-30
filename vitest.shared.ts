import { fileURLToPath } from "node:url";

interface SourceAlias {
  find: string | RegExp;
  replacement: string;
}

export function packageSourceAliases(name: string, source: URL): SourceAlias[] {
  const path = fileURLToPath(source).replaceAll("\\", "/").replace(/\/$/, "");

  return [
    { find: new RegExp(`^#${name}$`), replacement: `${path}/index.ts` },
    {
      find: new RegExp(`^#${name}/(.*\\.(?:vue|svg)(?:\\?.*)?)$`),
      replacement: `${path}/$1`,
    },
    { find: new RegExp(`^#${name}/(.*)$`), replacement: `${path}/$1.ts` },
  ];
}

export function sourceAliases(root: URL): SourceAlias[] {
  return ["contracts", "manager"].flatMap((name) =>
    packageSourceAliases(name, new URL(`packages/${name}/src/`, root)),
  );
}
