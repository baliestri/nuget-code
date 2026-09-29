import { describe, expect, it } from "vitest";
import type { VersionDeclarationChange } from "#contracts";
import { planVersionDeclaration } from "./version-declaration";

const change: VersionDeclarationChange = {
  declarationPath: "/repo/Shared.props",
  kind: "PackageReference",
  packageId: "Demo",
  expectedVersion: "1.0.0",
  version: "1.5.0",
  affectedProjectPaths: ["/repo/App.csproj"],
};
function edit(text: string, request = change): string {
  const result = planVersionDeclaration(text, request);
  return result
    ? text.slice(0, result.start) +
        result.replacementText +
        text.slice(result.end)
    : text;
}

describe("literal version declarations", () => {
  it("preserves BOM, Unicode, CRLF, comments, conditions, quote style and spacing", () => {
    const text =
      "\ufeff<Project>\r\n  <!-- versão 💡: <PackageReference Include=\"Demo\" Version=\"1.0.0\"/> -->\r\n  <ItemGroup Condition=\"'$(TargetFramework)' > 'net7.0'\">\r\n    <PackageReference Include='Demo' Version = ' 1.0.0 ' PrivateAssets=\"all\" />\r\n  </ItemGroup>\r\n</Project>\r\n";
    expect(edit(text)).toBe(
      text.replace("Version = ' 1.0.0 '", "Version = ' 1.5.0 '"),
    );
  });

  it("edits a Version child while preserving its surrounding whitespace and comments", () => {
    const text =
      '<Project><ItemGroup><PackageReference Include="Demo"><Version><!-- pinned -->\n  1.0.0\n</Version><PrivateAssets>all</PrivateAssets></PackageReference></ItemGroup></Project>';
    expect(edit(text)).toBe(text.replace("  1.0.0\n", "  1.5.0\n"));
  });

  it("supports the standard MSBuild namespace and central versions", () => {
    const text =
      '<m:Project xmlns:m="http://schemas.microsoft.com/developer/msbuild/2003"><m:ItemGroup><m:PackageVersion Include="Demo"><m:Version>1.0.0</m:Version></m:PackageVersion></m:ItemGroup></m:Project>';
    expect(edit(text, { ...change, kind: "PackageVersion" })).toBe(
      text.replace(">1.0.0<", ">1.5.0<"),
    );
  });

  it("handles encoded literals without touching other package versions", () => {
    const text =
      '<Project><ItemGroup><PackageReference Include="Demo" Version="1&#46;0&#46;0"/><PackageReference Include="Other" Version="1.0.0"/></ItemGroup></Project>';
    expect(edit(text)).toBe(text.replace("1&#46;0&#46;0", "1.5.0"));
  });

  it("does not rewrite an equivalent version for cosmetic normalization", () => {
    const text =
      '<Project><ItemGroup><PackageReference Include="Demo" Version="1.0"/></ItemGroup></Project>';
    expect(
      planVersionDeclaration(text, { ...change, version: "1.0.0+metadata" }),
    ).toBeUndefined();
  });

  it("does not treat an unsupported version representation as a validated no-op", () => {
    const text =
      '<Project xmlns:x="urn:other"><ItemGroup><PackageReference Include="Demo"><x:Version>1.0.0</x:Version></PackageReference></ItemGroup></Project>';
    expect(() => edit(text, { ...change, version: "1.0.0" })).toThrow(
      expect.objectContaining({ code: "unsupported-declaration" }),
    );
  });

  it.each([
    '<PackageReference Include="Demo" Version="$(DemoVersion)"/>',
    '<PackageReference Include="Demo" Version="[1,2)"/>',
    '<PackageReference Include="Demo"/>',
    '<PackageReference Include="Demo" VersionOverride="1.0.0"/>',
    '<PackageReference Include="Demo" Version="1.0.0" VersionOverride="1.0.0"/>',
    '<PackageReference Update="Demo" Version="1.0.0"/>',
    '<PackageReference Include="Demo" Version="1.0.0"><Version>1.0.0</Version></PackageReference>',
    '<PackageReference Include="Demo"><Version>1.<!-- split -->0.0</Version></PackageReference>',
  ])("refuses unsupported or ambiguous declaration %s", (declaration) => {
    expect(() =>
      edit(`<Project><ItemGroup>${declaration}</ItemGroup></Project>`),
    ).toThrow();
  });

  it("refuses duplicate conditional declarations even when versions happen to match", () => {
    const text =
      '<Project><ItemGroup><PackageReference Include="Demo" Version="1.0.0" Condition="A"/><PackageReference Include="Demo" Version="1.0.0" Condition="B"/></ItemGroup></Project>';
    expect(() => edit(text)).toThrow(
      expect.objectContaining({ code: "ambiguous-declaration" }),
    );
  });

  it("rejects a source version that differs from the evaluated intent", () => {
    const text =
      '<Project><ItemGroup><PackageReference Include="Demo" Version="2.0.0"/></ItemGroup></Project>';
    expect(() => edit(text)).toThrow(
      expect.objectContaining({ code: "source-version-mismatch" }),
    );
  });

  it("does not select declaration-looking text or target-time items", () => {
    expect(() =>
      edit(
        '<Project><!-- <PackageReference Include="Demo" Version="1.0.0"/> --></Project>',
      ),
    ).toThrow();
    expect(() =>
      edit(
        '<Project><Target Name="Later"><ItemGroup><PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Target></Project>',
      ),
    ).toThrow();
    expect(() =>
      edit(
        '<Project xmlns:x="urn:other"><ItemGroup><x:PackageReference Include="Demo" Version="1.0.0"/></ItemGroup></Project>',
      ),
    ).toThrow();
  });

  it("rejects malformed XML and invalid candidate versions", () => {
    expect(() => edit("<Project>")).toThrow(
      expect.objectContaining({ code: "invalid-xml" }),
    );
    expect(() => edit("<Project/>", { ...change, version: "1.*" })).toThrow(
      expect.objectContaining({ code: "invalid-version" }),
    );
  });
});
