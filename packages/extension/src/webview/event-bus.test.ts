import { describe, expect, it, vi } from "vitest";
import { PackageManagerEventBus } from "./event-bus.js";

describe("PackageManagerEventBus", () => {
  it("publishes to subscribed listeners and disposes subscriptions", () => {
    const bus = new PackageManagerEventBus();
    const first = vi.fn();
    const second = vi.fn();

    const firstSubscription = bus.subscribe(first);
    bus.subscribe(second);
    bus.publish({ type: "logs", entries: [] });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    firstSubscription.dispose();
    bus.publish({ type: "foldersChanged", folders: [] });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);

    bus.dispose();
    bus.publish({ type: "logs", entries: [] });
    expect(second).toHaveBeenCalledTimes(2);
  });
});
