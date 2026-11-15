import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODULE_FILES, powershellVersion } from "./console-module";

const repository = fileURLToPath(new URL("../", import.meta.url));

describe("the version of PowerShell the console is built for", () => {
  it("is the version of System.Management.Automation", () => {
    const props = `
      <Project>
        <ItemGroup>
          <PackageVersion Include="NuGet.Protocol" Version="8.0.0" />
          <PackageVersion Include="System.Management.Automation" Version="7.6.0" />
        </ItemGroup>
      </Project>`;

    expect(powershellVersion(props)).toBe("7.6.0");
  });

  it("a file without it, or with a version that is not X.Y.Z, is refused", () => {
    expect(() => powershellVersion("<Project />")).toThrow("System.Management.Automation");
    expect(() =>
      powershellVersion('<PackageVersion Include="System.Management.Automation" Version="7.6.*" />')
    ).toThrow("System.Management.Automation");
  });

  it("comes from Directory.Packages.props, the only place it is written", () => {
    const version = powershellVersion(readFileSync(`${repository}backend/Directory.Packages.props`, "utf8"));

    expect(version).toMatch(/^7\.\d+\.\d+$/);
    // The manifest states the least PowerShell the module loads in: the same major and minor.
    const manifest = readFileSync(`${repository}backend/src/NuGet.VisualStudioCode.Console/NuGetCode.psd1`, "utf8");
    expect(manifest).toContain(`PowerShellVersion    = '${version.split(".").slice(0, 2).join(".")}'`);
  });

  it("the files shipped are the ones the manifest names, and never PowerShell's own", () => {
    const manifest = readFileSync(`${repository}backend/src/NuGet.VisualStudioCode.Console/NuGetCode.psd1`, "utf8");

    for (const file of MODULE_FILES.filter((name) => !name.startsWith("en-US/") && name !== "NuGetCode.psd1")) {
      expect(manifest).toContain(`'${file}'`);
    }

    expect(MODULE_FILES).not.toContain("System.Management.Automation.dll");
  });
});
