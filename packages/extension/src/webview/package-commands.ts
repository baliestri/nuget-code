import path from "node:path";
import { randomUUID } from "node:crypto";
import { window } from "vscode";
import type {
  MutationPlan,
  MutationStep,
  PackageManagerState,
  UpgradeContext,
  WorkspaceTarget,
} from "#contracts";
import {
  createUpgradePlan,
  executableCandidates,
  freezeMutationPlan,
  getSelectedPackage,
  getSelectedTarget,
  parseNuGetVersion,
  compareNuGetVersions,
} from "#manager";
import { pathKey } from "#client/project-files";

interface Options {
  getState(): PackageManagerState;
  submit(
    plan: MutationPlan,
    target: WorkspaceTarget,
    context: UpgradeContext,
    automatic: boolean,
  ): Promise<unknown>;
}
export class PackageCommandService {
  constructor(private readonly options: Options) {}
  async restorePackages(): Promise<void> {
    const state = this.options.getState();
    const target = getSelectedTarget(state);
    if (!target) {
      void window.showWarningMessage("No .NET target is selected.");
      return;
    }
    const captured = structuredClone(target);
    const projects =
      target.kind === "project" ? [target.path] : [...target.projectPaths];
    const context = {
      ...state.updates.context,
      targetId: target.id,
      projectPaths: projects,
    };
    const plan = freezeMutationPlan({
      id: randomUUID(),
      targetId: target.id,
      contextRevision: context.revision,
      steps: projects.map((file, index) => ({
        id: String(index),
        kind: "restore",
        action: "restore",
        projectPaths: [file],
        packageId: null,
        version: null,
        feedUrls: [],
      })),
    });
    await this.options.submit(plan, captured, context, false);
  }
  async upgradePackages(): Promise<void> {
    const state = this.options.getState();
    const target = getSelectedTarget(state);
    if (!target) return;
    const plan = createUpgradePlan(
      randomUUID(),
      state.updates.context,
      state.updates.evaluation,
    );
    if (!plan.steps.length) {
      void window.showInformationMessage("No verified upgrades are available.");
      return;
    }
    await this.options.submit(
      plan,
      structuredClone(target),
      structuredClone(state.updates.context),
      true,
    );
  }
  async upgradeCandidates(keys: string[], revision: string): Promise<void> {
    const state = this.options.getState();
    const target = getSelectedTarget(state);
    const context = state.updates.context;
    if (
      !target ||
      target.id !== context.targetId ||
      revision !== context.revision
    )
      throw new Error("The update selection is stale. Select packages again.");
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.some((key) => typeof key !== "string") ||
      new Set(keys).size !== keys.length
    )
      throw new Error("Invalid update selection.");
    const eligible = new Map(
      executableCandidates(state.updates.evaluation).map((candidate) => [
        candidate.key,
        candidate,
      ]),
    );
    const candidates = keys.map((key) => {
      const candidate = eligible.get(key);
      if (!candidate)
        throw new Error(
          "An update is no longer eligible. Select packages again.",
        );
      return candidate;
    });
    const plan = createUpgradePlan(randomUUID(), context, {
      candidates,
      blocked: [],
    });
    await this.options.submit(
      plan,
      structuredClone(target),
      structuredClone(context),
      true,
    );
  }
  async addOrUpgradeSelectedPackage(
    _command: "addPackage" | "upgradeSelectedPackage",
    options: {
      version?: string | undefined;
      feedId?: string | undefined;
      projectPaths?: string[] | undefined;
    },
  ): Promise<void> {
    await this.packageOperation("update", options);
  }
  async removeSelectedPackage(projectPaths?: string[]): Promise<void> {
    await this.packageOperation("remove", { projectPaths });
  }
  private async packageOperation(
    action: "update" | "remove",
    options: {
      version?: string | undefined;
      feedId?: string | undefined;
      projectPaths?: string[] | undefined;
    },
  ): Promise<void> {
    const state = this.options.getState();
    const target = getSelectedTarget(state);
    const item = getSelectedPackage(state);
    if (!target || !item) return;
    if (
      item.name.length > 100 ||
      !/^[\p{L}\p{Mn}\p{Nd}\p{Pc}]+(?:[.-][\p{L}\p{Mn}\p{Nd}\p{Pc}]+)*(?![\s\S])/u.test(
        item.name,
      )
    )
      throw new Error("Invalid NuGet package identity.");
    if (
      action !== "remove" &&
      (!options.version || !parseNuGetVersion(options.version))
    )
      throw new Error("Select a concrete package version.");
    const captured = structuredClone(target);
    const allowed =
      target.kind === "project" ? [target.path] : [...target.projectPaths];
    const feeds = state.feeds
      .filter(
        (feed) =>
          feed.enabled &&
          feed.id !== "__all__" &&
          (!options.feedId ||
            options.feedId === "__all__" ||
            feed.id === options.feedId),
      )
      .map((feed) => feed.url);
    const context = structuredClone({
      ...state.updates.context,
      targetId: target.id,
      feedUrls: feeds,
      includePrerelease: state.includePrerelease,
    });
    const requested =
      options.projectPaths ??
      (
        await window.showQuickPick(
          allowed.map((file) => ({
            label: path.basename(file),
            description: file,
            picked: item.projectPaths.some(
              (value) => pathKey(value) === pathKey(file),
            ),
            file,
          })),
          {
            canPickMany: true,
            placeHolder: "Select projects",
            ignoreFocusOut: true,
          },
        )
      )?.map((item) => item.file);
    if (!requested?.length) return;
    const projects = [
      ...new Set(
        requested.map(
          (file) =>
            allowed.find((known) => pathKey(known) === pathKey(file)) ?? "",
        ),
      ),
    ];
    if (projects.some((file) => !file))
      throw new Error(
        "The requested projects are outside the captured target.",
      );
    context.projectPaths = projects;
    const steps: MutationStep[] = projects.map((file, index) => {
      const references = state.installedReferences.filter(
        (reference) =>
          reference.direct &&
          pathKey(reference.projectPath) === pathKey(file) &&
          reference.packageId.toLowerCase() === item.name.toLowerCase(),
      );
      const nextAction =
        action === "remove"
          ? "remove"
          : !references.length
            ? "add"
            : references.some(
                  (reference) =>
                    reference.resolvedVersion &&
                    compareNuGetVersions(
                      options.version!,
                      reference.resolvedVersion,
                    ) < 0,
                )
              ? "downgrade"
              : "update";
      return {
        id: String(index),
        kind: "package",
        action: nextAction,
        projectPaths: [file],
        packageId: item.name,
        version: action === "remove" ? null : options.version!,
        feedUrls: feeds,
      };
    });
    await this.options.submit(
      freezeMutationPlan({
        id: randomUUID(),
        targetId: captured.id,
        contextRevision: context.revision,
        steps,
      }),
      captured,
      context,
      false,
    );
  }
}
