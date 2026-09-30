// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { NuGetPackageItem, UpgradeCandidate } from "#contracts";
import { usePackageManagerStore } from "#webview/stores/packageManager";
import FeedFilter from "./FeedFilter.vue";
import PackagesView from "./PackagesView.vue";
import PackageDetails from "./PackageDetails.vue";
const vscode = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock("#webview/composables/useVsCodeApi", () => ({
  useVsCodeApi: () => vscode,
}));
beforeEach(() => {
  setActivePinia(createPinia());
  vscode.postMessage.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const feeds = [
  { id: "a", name: "Public", url: "https://a.test/index.json", enabled: true },
  { id: "b", name: "Public", url: "https://b.test/index.json", enabled: true },
];
function item(name: string): NuGetPackageItem {
  return {
    id: name,
    name,
    installedVersion: "1.0.0",
    projectPaths: [],
    versions: [],
    dependencyGroups: [],
  };
}
function candidate(name: string, verified = true): UpgradeCandidate {
  return {
    key: name,
    packageId: name,
    projectPath: "App.csproj",
    referenceIds: [],
    version: "2.0.0",
    feedUrls: [],
    compatibility: verified
      ? { status: "compatible", diagnostics: [] }
      : { status: "unverified", reason: "incomplete-catalog", diagnostics: [] },
  };
}
function setup() {
  const store = usePackageManagerStore();
  store.model.installedPackages = [
    item("Alpha"),
    item("Beta"),
    item("Pending"),
  ];
  store.model.feeds = feeds;
  store.model.updates.evaluation.candidates = [
    candidate("Alpha"),
    candidate("Beta"),
    candidate("Pending", false),
  ];
  store.model.updates.context.revision = "r1";
  const wrapper = mount(PackagesView, {
    props: { sortMode: "smart" },
    global: {
      stubs: {
        VscodeSplitPane: {
          template: '<div><slot name="start"/><slot name="end"/></div>',
        },
        PackageDetails: true,
        TargetSelect: true,
      },
    },
  });
  return { store, wrapper };
}
it("changes explicit feed selection without mutating feed definitions or querying on open", async () => {
  const wrapper = mount(FeedFilter, {
    props: { feeds, filter: { mode: "all" } },
  });
  await wrapper.get("summary").trigger("click");
  expect(wrapper.emitted("change")).toBeUndefined();
  await wrapper
    .get('input[aria-label="Public: https://a.test/index.json"]')
    .setValue(false);
  expect(wrapper.emitted("change")?.[0]).toEqual([
    { mode: "selected", ids: ["b"] },
  ]);
  expect(feeds.every((feed) => feed.enabled)).toBe(true);
  await wrapper.setProps({ filter: { mode: "selected", ids: [] } });
  expect(wrapper.get("summary").text()).toBe("No feeds selected");
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("manage")).toHaveLength(1);
  wrapper.unmount();
});
it("keeps Installed searches local, switches tabs by keyboard, and keeps implicit packages collapsed", async () => {
  const { wrapper } = setup();
  expect(wrapper.findAll("h2 button")[2]?.attributes("aria-expanded")).toBe(
    "false",
  );
  await wrapper.get('input[type="search"]').setValue("Alpha");
  vi.advanceTimersByTime(1000);
  expect(vscode.postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "setSearch" }),
  );
  expect(wrapper.get("#installed-panel").text()).not.toContain("Beta");
  await wrapper.get("#installed-tab").trigger("keydown", { key: "ArrowRight" });
  expect(wrapper.get("#discover-tab").attributes("aria-selected")).toBe("true");
  await wrapper.get('input[type="search"]').setValue("remote");
  vi.advanceTimersByTime(1000);
  expect(vscode.postMessage).toHaveBeenCalledWith({
    type: "setSearch",
    search: "remote",
  });
  wrapper.unmount();
});
it("selects only visible verified candidates independently from details, reports indeterminate state and invalidates context", async () => {
  const { wrapper, store } = setup();
  const selection = vi.spyOn(store, "selectPackageItem");
  expect(
    wrapper
      .get('input[aria-label="Select update for Pending"]')
      .attributes("disabled"),
  ).toBeDefined();
  await wrapper
    .get('input[aria-label="Select update for Alpha"]')
    .setValue(true);
  expect(selection).not.toHaveBeenCalled();
  expect(
    (
      wrapper.get('input[aria-label="Select all visible eligible updates"]')
        .element as HTMLInputElement
    ).indeterminate,
  ).toBe(true);
  const update = () =>
    wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("Update ("))!;
  expect(update().text()).toBe("Update (1)");
  await update().trigger("click");
  expect(vscode.postMessage).toHaveBeenCalledWith({
    type: "upgradeCandidates",
    keys: ["Alpha"],
    revision: "r1",
  });
  await wrapper.get('input[type="search"]').setValue("Beta");
  expect(update().text()).toBe("Update (0)");
  await wrapper
    .get('input[aria-label="Select all visible eligible updates"]')
    .setValue(true);
  expect(update().text()).toBe("Update (1)");
  store.model.updates.context.revision = "r2";
  await wrapper.vm.$nextTick();
  expect(update().text()).toBe("Update (0)");
  wrapper.unmount();
});
it("presents optional metadata before projects, retains known zero and routes links through the host", async () => {
  const store = usePackageManagerStore();
  const packageItem = {
    ...item("Alpha"),
    totalDownloads: 0,
    projectUrl: "https://project.test",
    frameworks: ["net8.0"],
  };
  const wrapper = mount(PackageDetails, {
    props: { packageItem },
    global: { stubs: { LoadStatus: true } },
  });
  expect(wrapper.text()).toContain("Downloads0");
  expect(wrapper.text()).toContain("net8.0");
  expect(wrapper.text().indexOf("Info")).toBeLessThan(
    wrapper.text().lastIndexOf("Projects"),
  );
  const link = vi.spyOn(store, "openPackageLink");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Project")!
    .trigger("click");
  expect(link).toHaveBeenCalledWith("https://project.test");
  expect(wrapper.find("a[href]").exists()).toBe(false);
  wrapper.unmount();
});

it("preserves installed and previous search data while refreshing, and distinguishes explicit empty feeds", async () => {
  const { wrapper, store } = setup();
  store.model.availablePackages = [item("PreviousResult")];
  store.model.flows.search = {
    status: "failed",
    stale: true,
    error: "Offline",
  };
  store.model.feedFilter = { mode: "selected", ids: [] };
  await wrapper.vm.$nextTick();
  expect(wrapper.get("#installed-panel").text()).toContain("Alpha");
  await wrapper.get("#discover-tab").trigger("click");
  expect(wrapper.get("#discover-panel").text()).toContain("No feeds selected");
  store.model.feedFilter = { mode: "all" };
  await wrapper.vm.$nextTick();
  expect(wrapper.get("#discover-panel").text()).toContain("PreviousResult");
  store.model.availablePackages = [];
  store.model.flows.search = { status: "loading", stale: false, error: null };
  await wrapper.vm.$nextTick();
  expect(wrapper.get("#discover-panel").text()).toContain("Loading packages");
  wrapper.unmount();
});

it("keeps the feed popup within the viewport and returns keyboard focus on Escape without querying", async () => {
  const wrapper = mount(FeedFilter, {
    attachTo: document.body,
    props: { feeds, filter: { mode: "all" } },
  });
  const summary = wrapper.get("summary");
  vi.spyOn(summary.element, "getBoundingClientRect").mockReturnValue({
    left: 50,
    right: 180,
    top: 40,
    bottom: 65,
    width: 130,
    height: 25,
    x: 50,
    y: 40,
    toJSON: () => ({}),
  });
  const panel = wrapper.get("div.fixed");
  vi.spyOn(panel.element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 288,
    top: 0,
    bottom: 150,
    width: 288,
    height: 150,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  (wrapper.element as HTMLDetailsElement).open = true;
  await wrapper.trigger("toggle");
  await wrapper.vm.$nextTick();
  expect((panel.element as HTMLElement).style.left).toBe("8px");
  await panel.trigger("keydown", { key: "Escape" });
  expect((wrapper.element as HTMLDetailsElement).open).toBe(false);
  expect(document.activeElement).toBe(summary.element);
  expect(wrapper.emitted("change")).toBeUndefined();
  wrapper.unmount();
});
