// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { CompatibilityResult, UpgradeCandidate } from "#contracts";
import CompatibilityIndicator from "./CompatibilityIndicator.vue";

function candidate(
  projectPath: string,
  compatibility: CompatibilityResult,
): UpgradeCandidate {
  return {
    key: projectPath,
    packageId: "Demo",
    projectPath,
    referenceIds: [],
    version: "2.0.0",
    feedUrls: [],
    compatibility,
  };
}

it("explains each project's verification result on focus and hover, and dismisses on Escape", async () => {
  const wrapper = mount(CompatibilityIndicator, {
    attachTo: document.body,
    props: {
      candidates: [
        candidate("src/App.csproj", {
          status: "unverified",
          reason: "incomplete-catalog",
          diagnostics: [],
        }),
        candidate("src/Api.csproj", { status: "compatible", diagnostics: [] }),
      ],
    },
  });
  expect(wrapper.find(".codicon-question").exists()).toBe(true);
  const icon = wrapper.get('[role="img"]');
  const tooltip = wrapper.get('[role="tooltip"]');
  expect(icon.attributes("aria-describedby")).toBe(tooltip.attributes("id"));
  expect(icon.attributes("aria-label")).toBe(
    "Update compatibility not verified",
  );
  expect(tooltip.isVisible()).toBe(false);
  await icon.trigger("focus");
  expect(tooltip.isVisible()).toBe(true);
  expect(tooltip.text()).toContain("src/App.csproj — 2.0.0");
  expect(tooltip.text()).toContain("Package source data is incomplete.");
  expect(tooltip.text()).toContain("Excluded from Update All.");
  expect(tooltip.text()).toContain("src/Api.csproj — 2.0.0");
  expect(tooltip.text()).toContain("Eligible for Update All.");
  await icon.trigger("keydown", { key: "Escape" });
  expect(tooltip.isVisible()).toBe(false);
  await wrapper.trigger("mouseenter");
  expect(tooltip.isVisible()).toBe(true);
  await wrapper.trigger("mouseleave");
  expect(tooltip.isVisible()).toBe(false);
  wrapper.unmount();
});

it("distinguishes pending verification from verified and inconclusive results", async () => {
  const wrapper = mount(CompatibilityIndicator, {
    props: {
      candidates: [
        candidate("App.csproj", {
          status: "unverified",
          reason: "compatibility-not-verified",
          diagnostics: [],
        }),
      ],
    },
  });
  expect(wrapper.find(".codicon-sync.animate-spin").exists()).toBe(true);
  await wrapper.setProps({
    candidates: [
      candidate("App.csproj", { status: "compatible", diagnostics: [] }),
    ],
  });
  expect(wrapper.find(".codicon-check").exists()).toBe(true);
  await wrapper.setProps({
    candidates: [
      candidate("App.csproj", {
        status: "unverified",
        reason: "future-internal-code",
        diagnostics: [],
      }),
    ],
  });
  expect(wrapper.find(".codicon-question").exists()).toBe(true);
  expect(wrapper.text()).toContain("No applicable compatibility verification");
  expect(wrapper.text()).not.toContain("future-internal-code");
  wrapper.unmount();
});
