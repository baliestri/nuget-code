import { createHash } from "node:crypto";
import type {
  CompatibilityEvidence,
  InventorySnapshot,
  LoadState,
  NuGetPackageItem,
  PackageCatalog,
  PlannedCompatibilityEvidence,
  ReadFlow,
  UpdateProjection,
  UpgradeCandidate,
  UpgradeContext,
} from "#contracts";
import type { CompatibilityRequest } from "#client";
import { cachePolicy } from "#client/cache";
import { candidateKey, evaluateUpgrades } from "#manager";
import {
  ReadCoordinator,
  type ReadTicket,
} from "#extension/webview/read-coordinator";

export type CandidateVerification =
  | {
      kind: "verified";
      request: CompatibilityRequest;
      evidence: PlannedCompatibilityEvidence;
    }
  | { kind: "unverified"; reason: string };
export interface PackageDataPort {
  loadInventory(
    context: UpgradeContext,
    signal: AbortSignal,
    force: boolean,
  ): Promise<InventorySnapshot>;
  loadCatalogs(
    snapshot: InventorySnapshot,
    context: UpgradeContext,
    signal: AbortSignal,
    force: boolean,
  ): Promise<PackageCatalog[]>;
  verify(
    candidate: UpgradeCandidate,
    snapshot: InventorySnapshot,
    context: UpgradeContext,
    signal: AbortSignal,
  ): Promise<CandidateVerification>;
  search?(
    query: string,
    context: UpgradeContext,
    signal: AbortSignal,
  ): Promise<{ packages: NuGetPackageItem[]; complete: boolean }>;
}
interface DataEvents {
  catalogs?(catalogs: readonly PackageCatalog[], context: UpgradeContext): void;
  inventory?(snapshot: InventorySnapshot, context: UpgradeContext): void;
  search?(
    packages: NuGetPackageItem[],
    query: string,
    context: UpgradeContext,
  ): void;
  flow?(flow: ReadFlow, state: LoadState): void;
}
export interface VerifiedCandidate {
  readonly selectionRevision: string;
  readonly verification: Extract<CandidateVerification, { kind: "verified" }>;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const inventoryKey = (context: UpgradeContext) =>
  hash([context.targetId, [...context.projectPaths].sort(), context.revision]);
const sourceKey = (context: UpgradeContext) =>
  hash([...context.feedUrls].sort());
const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

/** Owns facts and projections; a selection revision never replaces a project's proof revision. */
export class PackageDataService {
  private readonly reads = new ReadCoordinator();
  private context: UpgradeContext | undefined;
  private snapshot: InventorySnapshot | undefined;
  private inventoryFresh = false;
  private catalogs: PackageCatalog[] = [];
  private catalogsLoaded = false;
  private catalogsLoadedAt = 0;
  private readonly evidence = new Map<string, CompatibilityEvidence>();
  private readonly verified = new Map<string, VerifiedCandidate>();
  private inventoryWork: { key: string; promise: Promise<void> } | undefined;
  private disposed = false;
  private refreshGeneration = 0;
  private searchHasData = false;
  constructor(
    private readonly port: PackageDataPort,
    private readonly publish: (projection: UpdateProjection) => void,
    private readonly events: DataEvents = {},
  ) {}

  setContext(value: UpgradeContext): void {
    if (this.disposed) return;
    const next = structuredClone(value);
    const previous = this.context;
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    this.refreshGeneration++;
    const sameInventory =
      previous && inventoryKey(previous) === inventoryKey(next);
    const sameSources = previous && sourceKey(previous) === sourceKey(next);
    if (!sameInventory || !sameSources) this.searchHasData = false;
    this.context = next;
    this.reads.cancel("catalog");
    this.reads.cancel("search");
    if (!sameInventory) {
      this.reads.cancel("inventory");
      this.snapshot = undefined;
      this.inventoryFresh = false;
      this.inventoryWork = undefined;
      this.verified.clear();
      this.evidence.clear();
      this.catalogs = [];
      this.catalogsLoaded = false;
      this.flow("inventory", "idle", false);
    }
    if (!sameSources) {
      this.catalogs = [];
      this.catalogsLoaded = false;
      this.evidence.clear();
      this.verified.clear();
    }
    this.flow("catalog", "idle", !!this.catalogs.length);
    this.flow("search", "idle", false);
    this.emit(); // Filtering takes effect synchronously, before pending work can resolve.
  }

  async refresh(options: { force: boolean }): Promise<void> {
    if (!this.context || this.disposed) return;
    const generation = ++this.refreshGeneration;
    const key = inventoryKey(this.context);
    if (options.force) {
      this.reads.cancel("catalog");
      this.evidence.clear();
      this.verified.clear();
      this.catalogs = this.catalogs.map((catalog) => ({
        ...catalog,
        complete: false,
      }));
      this.catalogsLoaded = false;
      this.emit();
    }
    if (options.force || !this.inventoryFresh) {
      if (!options.force && this.inventoryWork?.key === key)
        await this.inventoryWork.promise;
      else {
        const promise = this.loadInventory(
          structuredClone(this.context),
          options.force,
        );
        const work = { key, promise };
        this.inventoryWork = work;
        await promise;
        if (this.inventoryWork === work) this.inventoryWork = undefined;
      }
    }
    if (
      generation !== this.refreshGeneration ||
      !this.context ||
      inventoryKey(this.context) !== key ||
      !this.snapshot ||
      !this.inventoryFresh ||
      this.disposed
    )
      return;
    const ticket = this.reads.begin(
      "catalog",
      hash([key, sourceKey(this.context), this.context.includePrerelease]),
    );
    let status: LoadState["status"] = "ready";
    let error: string | null = null;
    this.flow("catalog", "loading", this.catalogs.length > 0);
    try {
      if (
        options.force ||
        !this.catalogsLoaded ||
        Date.now() - this.catalogsLoadedAt >= cachePolicy.metadataTtlMs
      ) {
        const catalogs = await this.port.loadCatalogs(
          this.snapshot,
          this.effectiveContext(),
          ticket.signal,
          options.force,
        );
        if (!this.reads.isCurrent(ticket)) return;
        this.catalogs = catalogs;
        this.catalogsLoaded = catalogs.every((catalog) => catalog.complete);
        this.catalogsLoadedAt = Date.now();
        this.evidence.clear();
        this.verified.clear();
      }
      if (this.catalogs.some((catalog) => !catalog.complete)) {
        status = "failed";
        error = "One or more package sources could not be loaded.";
      }
      this.events.catalogs?.(this.catalogs, this.effectiveContext());
      this.emit();
      void this.verifyCandidates(ticket).catch(() => {
        /* The verification loop converts failures to inconclusive evidence. */
      });
    } catch (cause) {
      if (!this.reads.isCurrent(ticket)) return;
      status = isAbort(cause) ? "idle" : "failed";
      error = status === "failed" ? "Could not load package catalogs." : null;
      this.catalogsLoaded = false;
      this.catalogs = this.catalogs.map((catalog) => ({
        ...catalog,
        complete: false,
      }));
      this.evidence.clear();
      this.verified.clear();
      this.emit();
    } finally {
      if (this.reads.isCurrent(ticket))
        this.flow(
          "catalog",
          status,
          status !== "ready" && this.catalogs.length > 0,
          error,
        );
    }
  }

  async search(query: string): Promise<void> {
    if (!this.context || !this.port.search || this.disposed) return;
    const context = structuredClone(this.context);
    const ticket = this.reads.begin("search", hash([context, query]));
    this.flow("search", "loading", this.searchHasData);
    let status: LoadState["status"] = "failed";
    try {
      const result = await this.port.search(query, context, ticket.signal);
      if (result.complete) status = "ready";
      if (
        this.reads.isCurrent(ticket) &&
        (result.complete || result.packages.length > 0)
      ) {
        this.searchHasData = result.packages.length > 0;
        this.events.search?.(result.packages, query, this.effectiveContext());
      }
    } catch (error) {
      status = isAbort(error) ? "idle" : "failed";
    } finally {
      if (this.reads.isCurrent(ticket))
        this.flow(
          "search",
          status,
          status !== "ready" && this.searchHasData,
          status === "failed" ? "Could not search package sources." : null,
        );
    }
  }

  invalidate(targetId: string): void {
    if (this.context?.targetId !== targetId) return;
    this.refreshGeneration++;
    for (const flow of ["inventory", "catalog", "search"] as const)
      this.reads.cancel(flow);
    this.snapshot = undefined;
    this.inventoryFresh = false;
    this.catalogsLoaded = false;
    this.evidence.clear();
    this.verified.clear();
    this.catalogs = this.catalogs.map((catalog) => ({
      ...catalog,
      complete: false,
    }));
    this.flow("inventory", "idle", true);
    this.flow("catalog", "idle", true);
    this.flow("search", "idle", true);
    this.emit();
  }
  getVerifiedRequest(key: string): CompatibilityRequest | undefined {
    return this.getVerifiedCandidate(key)?.verification.request;
  }
  getVerifiedCandidate(key: string): VerifiedCandidate | undefined {
    const value = this.verified.get(key);
    if (
      !value ||
      !this.inventoryFresh ||
      this.disposed ||
      value.selectionRevision !== this.effectiveContext().revision ||
      !this.projection().evaluation.candidates.some(
        (candidate) =>
          candidate.key === key &&
          candidate.compatibility.status === "compatible",
      )
    )
      return undefined;
    return value;
  }
  cancelSearch(): void {
    this.reads.cancel("search");
    this.flow("search", "idle", this.searchHasData);
  }
  dispose(): void {
    this.disposed = true;
    this.reads.dispose();
    this.verified.clear();
    this.evidence.clear();
  }

  private async loadInventory(
    context: UpgradeContext,
    force: boolean,
  ): Promise<void> {
    this.inventoryFresh = false;
    const ticket = this.reads.begin("inventory", inventoryKey(context));
    this.flow("inventory", "loading", !!this.snapshot);
    let status: LoadState["status"] = "ready";
    try {
      const snapshot = await this.port.loadInventory(
        context,
        ticket.signal,
        force,
      );
      if (!this.reads.isCurrent(ticket)) return;
      if (snapshot.targetId !== context.targetId)
        throw new Error("Inventory target mismatch.");
      this.snapshot = structuredClone(snapshot);
      this.inventoryFresh = true;
      this.catalogsLoaded = false;
      this.evidence.clear();
      this.verified.clear();
      this.events.inventory?.(this.snapshot, this.effectiveContext());
      this.emit();
    } catch (error) {
      if (!this.reads.isCurrent(ticket)) return;
      status = isAbort(error) ? "idle" : "failed";
      this.evidence.clear();
      this.verified.clear();
      // Stale display data may survive, but cannot authorize upgrades.
      this.catalogs = this.catalogs.map((catalog) => ({
        ...catalog,
        complete: false,
      }));
      this.emit();
    } finally {
      if (this.reads.isCurrent(ticket))
        this.flow(
          "inventory",
          status,
          status !== "ready" && !!this.snapshot,
          status === "failed" ? "Could not load installed packages." : null,
        );
    }
  }
  private effectiveContext(): UpgradeContext {
    const context = this.context!;
    const projectPaths = this.snapshot?.projectPaths ?? context.projectPaths;
    return {
      ...context,
      projectPaths,
      revision: hash([
        context.targetId,
        context.includePrerelease,
        [...projectPaths].sort(),
        [...context.feedUrls].sort(),
        context.revision,
        this.snapshot?.revision ?? "pending",
      ]),
    };
  }
  private projection(): UpdateProjection {
    const context = this.effectiveContext();
    return {
      context,
      evaluation: evaluateUpgrades({
        inventory: this.snapshot?.references ?? [],
        catalogs: this.catalogs,
        context,
        evidence: this.evidence,
      }),
    };
  }
  private emit(): void {
    if (this.context && !this.disposed) this.publish(this.projection());
  }
  private flow(
    flow: ReadFlow,
    status: LoadState["status"],
    stale: boolean,
    error: string | null = null,
  ): void {
    if (!this.disposed) this.events.flow?.(flow, { status, stale, error });
  }
  private async verifyCandidates(ticket: ReadTicket): Promise<void> {
    const attempted = new Set<string>();
    while (this.reads.isCurrent(ticket) && this.snapshot) {
      const projection = this.projection();
      const candidate = projection.evaluation.candidates.find(
        (item) =>
          item.compatibility.status === "unverified" &&
          item.compatibility.reason === "compatibility-not-verified" &&
          !attempted.has(item.key),
      );
      if (!candidate) return;
      attempted.add(candidate.key);
      let verification: CandidateVerification;
      try {
        verification = await this.port.verify(
          candidate,
          this.snapshot,
          projection.context,
          ticket.signal,
        );
      } catch {
        verification = { kind: "unverified", reason: "verification-failed" };
      }
      if (
        !this.reads.isCurrent(ticket) ||
        projection.context.revision !== this.effectiveContext().revision
      )
        return;
      let result: CompatibilityEvidence["result"] = {
        status: "unverified",
        reason: "evidence-mismatch",
        diagnostics: [],
      };
      if (verification.kind === "unverified")
        result = {
          status: "unverified",
          reason: verification.reason,
          diagnostics: [],
        };
      else {
        const { request, evidence } = verification;
        if (
          candidate.key === candidateKey(request.candidate) &&
          evidence.candidateKey === candidate.key &&
          request.candidate.key === candidate.key &&
          evidence.contextRevision ===
            this.snapshot.projectRevisions[candidate.projectPath] &&
          evidence.contextRevision === request.project.contextRevision &&
          request.plan.contextRevision === evidence.contextRevision &&
          evidence.planRevision === request.planRevision &&
          hash(request.plan) === request.planRevision &&
          hash([...request.selectedProjectPaths].sort()) ===
            hash([...projection.context.projectPaths].sort())
        ) {
          result = evidence.result;
          if (result.status === "compatible")
            this.verified.set(candidate.key, {
              selectionRevision: projection.context.revision,
              verification,
            });
        }
      }
      // This is a projection-only envelope. The native project proof above is retained intact for O3.
      this.evidence.set(candidate.key, {
        contextRevision: projection.context.revision,
        result,
      });
      this.emit();
    }
  }
}
