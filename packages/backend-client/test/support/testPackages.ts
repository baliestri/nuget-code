import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";

interface Entry {
  name: string;
  data: Buffer;
}

/** Writes `<id>.<version>.nupkg` into the folder: the smallest package NuGet restores from a folder feed. */
export function createPackage(feedDirectory: string, id: string, version: string): string {
  mkdirSync(feedDirectory, { recursive: true });
  const nuspec = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>${id}</id>
    <version>${version}</version>
    <authors>tests</authors>
    <description>Test package ${id}.</description>
    <dependencies>
      <group targetFramework=".NETStandard2.0" />
    </dependencies>
  </metadata>
</package>
`;
  const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="nuspec" ContentType="application/octet" />
  <Default Extension="_" ContentType="application/octet" />
</Types>
`;
  const path = join(feedDirectory, `${id}.${version}.nupkg`);
  writeFileSync(
    path,
    zip([
      { name: `${id}.nuspec`, data: Buffer.from(nuspec) },
      { name: "[Content_Types].xml", data: Buffer.from(contentTypes) },
      { name: "lib/netstandard2.0/_._", data: Buffer.from(id) }
    ])
  );
  return path;
}

/** A zip archive with stored (uncompressed) entries. */
function zip(entries: readonly Entry[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + entry.data.length;
  }

  const directorySize = directory.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}
