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

it.each(["central", "simple", "explicit-central", "explicit-simple"] as const)(
  "executes fixed %s operations with the effective SDK and actual inventory",
  async (scenario) => {
    const layout = scenario.includes("central") ? "central" : "simple";
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
      if (scenario.startsWith("explicit")) {
        if (layout === "simple")
          await checkedDotnet(
            fixture.cli,
            [
              "add",
              projects[0]!,
              "package",
              "Demo",
              "--version",
              "1.0.0",
              "--source",
              fixture.feedPath,
            ],
            fixture.root,
          );
        await fs.unlink(path.join(fixture.root, "Directory.Build.targets"));
        await fs.writeFile(
          path.join(fixture.root, "Extra.Config"),
          "<configuration/>",
        );
      }
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
        configPaths: [
          path.join(fixture.root, "NuGet.Config"),
          ...(scenario.startsWith("explicit")
            ? [path.join(fixture.root, "Extra.Config")]
            : []),
        ],
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
        { context, environment, automatic: scenario === "central" },
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
      if (scenario === "explicit-central") {
        const scoped = new PackageMutationPort(
          {
            context: { ...context, projectPaths: [projects[0]!] },
            environment,
            automatic: false,
          },
          () => environment,
          logger,
          async () => {},
          editor,
        );
        const expanded = await scoped.prepare(
          { ...plan, steps: [plan.steps[0]!] },
          new AbortController().signal,
        );
        expect(expanded.plan.steps[0]!.projectPaths).toEqual(projects);
        const approved = await scoped.prepare(
          expanded.plan,
          new AbortController().signal,
        );
        expect(approved.plan.steps[0]!.projectPaths).toEqual(projects);
      }
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
      if (scenario === "simple") {
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
