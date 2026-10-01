import { expect, it } from "vitest";
import { createEmptyPackageManagerState } from "#manager";
import { StateMessageSequence } from "./state-message-sequence";
it("keeps snapshots and every kind of delta in a single host revision sequence", () => {
  const sender = new StateMessageSequence("host");
  expect(
    sender.next({ type: "state", state: createEmptyPackageManagerState() }),
  ).toMatchObject({ sessionId: "host", revision: 1 });
  expect(
    sender.next({ type: "stateDelta", patch: { search: "demo" } }),
  ).toEqual({
    type: "stateDelta",
    patch: { search: "demo" },
    sessionId: "host",
    baseRevision: 1,
    revision: 2,
  });
  expect(sender.next({ type: "logs", entries: [] })).toMatchObject({
    sessionId: "host",
    baseRevision: 2,
    revision: 3,
  });
  expect(
    sender.next({ type: "state", state: createEmptyPackageManagerState() }),
  ).toMatchObject({ sessionId: "host", revision: 4 });
  expect(new StateMessageSequence().sessionId).not.toBe(
    new StateMessageSequence().sessionId,
  );
});
