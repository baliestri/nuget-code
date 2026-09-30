import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import {
  checkedDotnet,
  createDotnetFixture,
} from "#client/test/dotnet-fixture";
import { decodeProjectText, encodeProjectText } from "#client/project-files";
import { NuGetClient } from "#client";
import { PackageMutationPort } from "./package-mutation-port";
import { runMutation } from "./mutation-runner";
import type { DataEnvironment } from "./package-data-adapter";
import type { MutationPlan } from "#contracts";
import type { EditorPort } from "./version-edit-io";

it.each(["central", "simple"] as const)(
  "executes fixed %s operations with the effective SDK and actual inventory",
  async (layout) => {
    const fixture = await createDotnetFixture({
      sdkMajor: Number(process.env.SDK_MAJOR),
      layout,
    });
    const logger = {
      verbose: () => {},
      information: () => {},
      warning: () => {},
      error: () => {},
    };
    try {
      const projects = await Promise.all(
        (layout === "central"
          ? [
              fixture.projectPath,
              path.join(fixture.root, "Other", "Other.csproj"),
            ]
          : [fixture.projectPath]
        ).map((file) => fs.realpath(file)),
      );
      for (const file of projects)
        await checkedDotnet(
          fixture.cli,
          [
            "restore",
            file,
            "--configfile",
            path.join(fixture.root, "NuGet.Config"),
          ],
          path.dirname(file),
        );
      const environment: DataEnvironment = {
        target: {
          id: "target",
          name: "Target",
          kind: "solution",
          path: path.join(fixture.root, "Fixture.sln"),
          projectPaths: projects,
        },
        feeds: [
          { id: "local", name: "Local", enabled: true, url: fixture.feedPath },
        ],
        configPaths: [path.join(fixture.root, "NuGet.Config")],
        allowedRoots: [fixture.root],
        settings: {
          dotnetPath: "dotnet",
          nugetPath: "nuget",
          proxy: "",
          maxSearchResults: 100,
          extraConfigPaths: [],
          credentialProviderPaths: [],
        },
        cli: fixture.cli,
        sourceRevision: "s",
      };
      const context = {
        targetId: "target",
        projectPaths: projects,
        feedUrls: [fixture.feedPath],
        includePrerelease: false,
        revision: "context",
      };
      const editor: EditorPort = {
        open: async (file) => {
          const bytes = await fs.readFile(file);
          const source = decodeProjectText(bytes);
          let text = source.text;
          let version = 1;
          return {
            text: () => text,
            version: () => version,
            dirty: () => false,
            edit: async (expected, next) => {
              if (expected !== version) return false;
              text = next;
              version++;
              return true;
            },
            save: async () => {
              if (!(await fs.readFile(file)).equals(bytes)) return false;
              await fs.writeFile(file, encodeProjectText(source, text));
              return true;
            },
          };
        },
      };
      let reconciled = 0;
      const port = new PackageMutationPort(
        { context, environment, automatic: layout === "central" },
        () => environment,
        logger,
        async () => {
          reconciled++;
        },
        editor,
      );
      const plan: MutationPlan = {
        id: "operation",
        targetId: "target",
        contextRevision: "old",
        steps: projects.map((project, i) => ({
          id: String(i),
          kind: "package",
          action: "update",
          packageId: "Demo",
          version: "1.5.0",
          projectPaths: [project],
          feedUrls: [fixture.feedPath],
        })),
      };
      const prepared = await port.prepare(plan, new AbortController().signal);
      const outcome = await runMutation(
        prepared.plan,
        {
          execute: prepared.execute,
          reconcile: () => port.reconcile(prepared.plan),
        },
        () => false,
      );
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        reconciliationError: null,
        cancelled: false,
      });
      expect(
        outcome.steps.every((step) => step.status === "completed"),
        JSON.stringify(outcome),
      ).toBe(true);
      expect(reconciled).toBe(1);
      expect(
        (
          await NuGetClient.loadInstalledReferences({
            target: environment.target,
            cli: fixture.cli,
            logger,
            readOnly: true,
          })
        )
          .filter((reference) => reference.packageId === "Demo")
          .every((reference) => reference.resolvedVersion === "1.5.0"),
      ).toBe(true);
      if (layout === "simple") {
        const remove = {
          ...plan,
          id: "remove",
          steps: plan.steps.map((step) => ({
            ...step,
            action: "remove" as const,
            version: null,
          })),
        };
        const removal = await port.prepare(
          remove,
          new AbortController().signal,
        );
        expect(
          (
            await runMutation(
              removal.plan,
              {
                execute: removal.execute,
                reconcile: () => port.reconcile(removal.plan),
              },
              () => false,
            )
          ).steps[0]?.status,
        ).toBe("completed");
        expect(
          await NuGetClient.loadInstalledReferences({
            target: environment.target,
            cli: fixture.cli,
            logger,
            readOnly: true,
          }),
        ).toEqual([]);
      }
    } finally {
      await fixture.dispose();
    }
  },
);
