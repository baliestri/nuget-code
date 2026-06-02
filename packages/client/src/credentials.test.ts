import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  findCredentialProvider,
  getFeedAuthorizationHeader,
} from "./credentials.js";

describe("NuGet credentials", () => {
  it("finds configured exe and dll credential providers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuget-cred-"));
    const exePath = path.join(root, "CredentialProvider.Microsoft.exe");
    fs.writeFileSync(exePath, "");

    expect(
      findCredentialProvider({
        dotnetPath: "dotnet-custom",
        nugetPath: "nuget",
        extraConfigPaths: [],
        credentialProviderPaths: [exePath],
        proxy: "",
        maxSearchResults: 20,
      }),
    ).toEqual({ command: exePath, argsPrefix: [] });

    const dllRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nuget-cred-dll-"));
    const nested = path.join(dllRoot, "netcore");
    fs.mkdirSync(nested);
    const dllPath = path.join(nested, "CredentialProvider.Microsoft.dll");
    fs.writeFileSync(dllPath, "");

    expect(
      findCredentialProvider({
        dotnetPath: "dotnet-custom",
        nugetPath: "nuget",
        extraConfigPaths: [],
        credentialProviderPaths: [dllRoot],
        proxy: "",
        maxSearchResults: 20,
      }),
    ).toEqual({ command: "dotnet-custom", argsPrefix: [dllPath] });
  });

  it("finds generic credential provider names", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuget-cred-any-"));
    const providerPath = path.join(root, "CredentialProvider.TeamCity.exe");
    fs.writeFileSync(providerPath, "");

    expect(
      findCredentialProvider({
        dotnetPath: "dotnet-custom",
        nugetPath: "nuget",
        extraConfigPaths: [],
        credentialProviderPaths: [root],
        proxy: "",
        maxSearchResults: 20,
      }),
    ).toEqual({ command: providerPath, argsPrefix: [] });
  });

  it("tries generic credential providers until one is applicable", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuget-cred-chain-"));
    fs.writeFileSync(
      path.join(root, "CredentialProvider.A.dll"),
      "process.exit(1);\n",
    );
    fs.writeFileSync(
      path.join(root, "CredentialProvider.B.dll"),
      [
        "const args = process.argv.slice(2);",
        "if (!args.includes('-Uri') || args.includes('-U')) process.exit(2);",
        "if (args.includes('-Verbosity')) process.exit(2);",
        "console.log('[Information] Credential provider selected cached credentials');",
        "console.log(JSON.stringify({ Username: 'user', Password: 'token' }));",
      ].join("\n"),
    );

    await expect(
      getFeedAuthorizationHeader({
        feed: {
          id: "generic",
          name: "Generic",
          url: `https://packages.example.test/feed-${Date.now()}/index.json`,
          enabled: true,
        },
        settings: {
          dotnetPath: process.execPath,
          nugetPath: "nuget",
          extraConfigPaths: [],
          credentialProviderPaths: [root],
          proxy: "",
          maxSearchResults: 20,
        },
        logger: {
          verbose: vi.fn(),
          information: vi.fn(),
          warning: vi.fn(),
          error: vi.fn(),
        },
      }),
    ).resolves.toEqual({
      authorizationHeader: `Basic ${Buffer.from("user:token", "utf8").toString("base64")}`,
      providerFound: true,
    });
  });

  it("accepts text username and password output from credential providers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuget-cred-text-"));
    fs.writeFileSync(
      path.join(root, "CredentialProvider.Text.dll"),
      [
        "console.log('[Information] Found credentials');",
        "console.log('Username: user');",
        "console.log('Password: token');",
      ].join("\n"),
    );

    await expect(
      getFeedAuthorizationHeader({
        feed: {
          id: "text",
          name: "Text",
          url: `https://packages.example.test/text-${Date.now()}/index.json`,
          enabled: true,
        },
        settings: {
          dotnetPath: process.execPath,
          nugetPath: "nuget",
          extraConfigPaths: [],
          credentialProviderPaths: [root],
          proxy: "",
          maxSearchResults: 20,
        },
        logger: {
          verbose: vi.fn(),
          information: vi.fn(),
          warning: vi.fn(),
          error: vi.fn(),
        },
      }),
    ).resolves.toEqual({
      authorizationHeader: `Basic ${Buffer.from("user:token", "utf8").toString("base64")}`,
      providerFound: true,
    });
  });

  it("falls back to Microsoft standalone JSON mode when generic output has no credentials", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuget-cred-ms-"));
    fs.writeFileSync(
      path.join(root, "CredentialProvider.Microsoft.dll"),
      [
        "const args = process.argv.slice(2);",
        "if (args.includes('-Uri')) {",
        "  console.log('[Information] Interactive provider output without credentials');",
        "  process.exit(0);",
        "}",
        "if (!args.includes('-U') || !args.includes('-F') || !args.includes('Json')) process.exit(2);",
        "if (!args.includes('-N') || !args.includes('false')) process.exit(2);",
        "if (!args.includes('-I') || !args.includes('true')) process.exit(2);",
        "console.log(JSON.stringify({ Username: 'user', Password: 'token' }));",
      ].join("\n"),
    );

    await expect(
      getFeedAuthorizationHeader({
        feed: {
          id: "microsoft",
          name: "Microsoft",
          url: `https://packages.example.test/ms-${Date.now()}/index.json`,
          enabled: true,
        },
        settings: {
          dotnetPath: process.execPath,
          nugetPath: "nuget",
          extraConfigPaths: [],
          credentialProviderPaths: [root],
          proxy: "",
          maxSearchResults: 20,
        },
        logger: {
          verbose: vi.fn(),
          information: vi.fn(),
          warning: vi.fn(),
          error: vi.fn(),
        },
        interactive: true,
        retry: true,
      }),
    ).resolves.toEqual({
      authorizationHeader: `Basic ${Buffer.from("user:token", "utf8").toString("base64")}`,
      providerFound: true,
    });
  });
});
