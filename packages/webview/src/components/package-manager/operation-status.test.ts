// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LoadStatus from "./LoadStatus.vue";
import OperationSummary from "./OperationSummary.vue";
it("shows stale failures with an accessible retry without hiding the state", async () => {
  const wrapper = mount(LoadStatus, {
    props: {
      label: "inventory",
      state: { status: "failed", stale: true, error: "Feed unavailable" },
    },
  });
  expect(wrapper.attributes("role")).toBe("alert");
  expect(wrapper.text()).toContain("Showing previous data");
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  wrapper.unmount();
});
it("binds confirmation to the exact operation/revision and explains cancellation waiting", async () => {
  const plan = {
    id: "op",
    targetId: "target",
    contextRevision: "revision",
    steps: [],
  };
  const wrapper = mount(OperationSummary, {
    props: {
      operation: { plan, status: "awaiting-confirmation", outcome: null },
    },
  });
  const button = wrapper
    .findAll("button")
    .find((button) => button.text() === "Apply this plan")!;
  await button.trigger("click");
  expect(wrapper.emitted("confirm")?.[0]).toEqual(["op", "revision", true]);
  await wrapper.setProps({
    operation: {
      plan,
      status: "running",
      cancelRequested: true,
      outcome: null,
    },
  });
  expect(wrapper.text()).toContain("Waiting for the current command");
  expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  wrapper.unmount();
});
