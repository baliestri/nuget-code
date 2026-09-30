import { describe, expect, it, vi } from "vitest";
import { PackageManagerEventBus } from "./event-bus.js";
import { StateMessageSequence } from "./state-message-sequence";

describe("PackageManagerEventBus", () => {
  it("publishes to subscribed listeners and disposes subscriptions", () => {
    const bus = new PackageManagerEventBus();
    const messages = new StateMessageSequence();
    const first = vi.fn();
    const second = vi.fn();

    const firstSubscription = bus.subscribe(first);
    bus.subscribe(second);
    bus.publish(messages.next({ type: "logs", entries: [] }));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    firstSubscription.dispose();
    bus.publish(messages.next({ type: "foldersChanged", folders: [] }));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);

    bus.dispose();
    bus.publish(messages.next({ type: "logs", entries: [] }));
    expect(second).toHaveBeenCalledTimes(2);
  });
});
