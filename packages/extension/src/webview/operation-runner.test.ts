import { describe, expect, it, vi } from "vitest";
import { PackageManagerOperationRunner } from "./operation-runner.js";

describe("PackageManagerOperationRunner", () => {
  it("publishes start and finish around successful actions", async () => {
    const publish = vi.fn();
    const logger = { information: vi.fn() };
    const runner = new PackageManagerOperationRunner(logger as never, publish);

    await runner.run("availablePackages", "Refreshing", async () => {});

    expect(logger.information).toHaveBeenCalledWith("vscode", "Refreshing");
    expect(publish).toHaveBeenNthCalledWith(1, {
      type: "operationStarted",
      operationId: "1",
      kind: "availablePackages",
      label: "Refreshing",
      requestId: undefined,
    });
    expect(publish).toHaveBeenNthCalledWith(2, {
      type: "operationFinished",
      operationId: "1",
      kind: "availablePackages",
      label: "Refreshing",
      requestId: undefined,
    });
  });

  it("publishes failures and rethrows", async () => {
    const publish = vi.fn();
    const runner = new PackageManagerOperationRunner(
      { information: vi.fn() } as never,
      publish,
    );

    await expect(
      runner.run("availablePackages", "Failing", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(publish).toHaveBeenLastCalledWith({
      type: "operationFailed",
      operationId: "1",
      kind: "availablePackages",
      label: "Failing",
      requestId: undefined,
      error: "boom",
    });
  });

  it("supports manual operation lifecycle and request IDs", () => {
    const publish = vi.fn();
    const runner = new PackageManagerOperationRunner(
      { information: vi.fn() } as never,
      publish,
    );

    const operation = runner.start("availablePackages", "Search", 7);
    runner.finish(operation);
    runner.fail(operation, "bad");

    expect(publish).toHaveBeenNthCalledWith(1, {
      type: "operationStarted",
      operationId: "1",
      kind: "availablePackages",
      label: "Search",
      requestId: 7,
    });
    expect(publish).toHaveBeenLastCalledWith({
      type: "operationFailed",
      operationId: "1",
      kind: "availablePackages",
      label: "Search",
      requestId: 7,
      error: "bad",
    });
  });
});
