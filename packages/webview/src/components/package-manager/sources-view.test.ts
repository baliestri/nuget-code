// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import SourcesView from "./SourcesView.vue";
import { usePackageManagerStore } from "#webview/stores/packageManager";

const api = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock("#webview/composables/useVsCodeApi", () => ({
  useVsCodeApi: () => api,
}));
afterEach(() => api.postMessage.mockReset());
it("provides keyboard-accessible source tabs, saves folder properties and displays a safe summary", async () => {
  const { store, wrapper, requests } = await fixture();
  store.model.sources[0]!.properties = { globalPackagesFolder: "cache" };
  store.model.sources[0]!.packageFolders = [
    {
      projectPath: "/workspace/A.csproj",
      globalPackagesFolder: "/user/packages",
      repositoryPath: "/workspace/packages",
    },
    {
      projectPath: "/workspace/B.csproj",
      globalPackagesFolder: "/user/packages",
      repositoryPath: "/workspace/packages",
    },
  ];
  store.model.sources[0]!.restoreConsent = {
    isGranted: true,
    isGrantedInSettings: true,
    isAutomatic: true,
  };
  store.model.sources[0]!.fallbackFolders = ["/fallback"];
  await wrapper
    .get("#sources-Feeds-tab")
    .trigger("keydown", { key: "ArrowRight" });
  expect(
    wrapper.get("#sources-Properties-tab").attributes("aria-selected"),
  ).toBe("true");
  expect(
    (
      wrapper.get('[aria-label="Global packages folder"]')
        .element as HTMLInputElement
    ).value,
  ).toBe("cache");
  expect(wrapper.get("#sources-Properties-panel").text()).not.toContain(
    "A.csproj",
  );
  expect(
    wrapper
      .get("#sources-Properties-panel")
      .text()
      .match(/\/user\/packages/g),
  ).toHaveLength(1);
  expect(wrapper.text()).not.toContain("Effective NuGet folder settings");
  await wrapper
    .get('[aria-label="Global packages folder"]')
    .setValue("new-cache");
  await wrapper.get("#sources-Properties-panel form").trigger("submit");
  expect(requests()[0].request).toMatchObject({
    sourceRevision: "source-old",
    destinationRevision: "disk-old",
    edit: {
      action: "properties",
      globalPackagesFolder: "new-cache",
      repositoryPath: "",
    },
  });
  await wrapper.get("#sources-Summary-tab").trigger("click");
  expect(
    wrapper.get('[aria-label="NuGet configuration summary"]').text(),
  ).toContain("Source = /workspace/packages");
  expect(
    wrapper.get('[aria-label="NuGet configuration summary"]').text(),
  ).toContain(
    "IsGranted = true, IsGrantedInSettings = true, IsAutomatic = true",
  );
  expect(
    wrapper.get('[aria-label="NuGet configuration summary"]').text(),
  ).toContain("### FallbackFolders\n* /fallback");
  expect(
    wrapper.get('[aria-label="NuGet configuration summary"]').text(),
  ).not.toContain("### Package folders");
  expect(
    wrapper.find('select[aria-label="Save source configuration in"]').exists(),
  ).toBe(false);
  wrapper.unmount();
});
async function fixture(effective = false, suggested = true) {
  setActivePinia(createPinia());
  const store = usePackageManagerStore();
  store.model.sources = [
    {
      id: "config",
      name: "NuGet.Config",
      path: effective ? "" : "/workspace/NuGet.Config",
      origin: effective ? "effective" : "workspace",
      scope: "/workspace",
      hasCredentials: false,
      revision: "source-old",
      feeds: [
        {
          id: "feed",
          name: "Local",
          url: "/workspace/packages",
          declaredUrl: "packages",
          enabled: true,
        },
      ],
    },
  ];
  store.model.selectedSourceId = "config";
  store.model.sourceEditor = {
    status: "idle",
    message: "",
    destinations: [
      {
        id: "/workspace/NuGet.Config",
        path: "/workspace/NuGet.Config",
        label: "Workspace",
        revision: "disk-old",
        suggested,
      },
      {
        id: "/user/NuGet.Config",
        path: "/user/NuGet.Config",
        label: "User",
        revision: "user-old",
      },
    ],
  };
  const wrapper = mount(SourcesView, {
    global: {
      stubs: {
        VscodeSplitPane: {
          template: '<div><slot name="start"/><slot name="end"/></div>',
        },
      },
    },
  });
  await nextTick();
  return {
    store,
    wrapper,
    requests: () =>
      api.postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "editSource"),
  };
}

it("sends a captured revision, preserves relative URL, and keeps the draft on failure", async () => {
  const { store, wrapper, requests } = await fixture();
  await wrapper.get('[aria-label="Edit Local"]').trigger("click");
  expect(
    (
      wrapper.get('[aria-label="Source URL or folder"]')
        .element as HTMLInputElement
    ).value,
  ).toBe("packages");
  await wrapper.get('[aria-label="Source name"]').setValue("Renamed");
  store.model.sources[0]!.revision = "source-new";
  await wrapper.get("form").trigger("submit");
  const request = requests()[0].request;
  expect(request).toMatchObject({
    requestId: expect.any(String),
    sourceRevision: "source-old",
    destinationRevision: "disk-old",
    edit: { name: "Renamed", url: "packages" },
  });
  expect(
    wrapper.get('button[type="submit"]').attributes("disabled"),
  ).toBeDefined();
  store.model.sourceEditor = {
    ...store.model.sourceEditor!,
    status: "failed",
    requestId: request.requestId,
    message: "The source changed. Reload Sources.",
  };
  await nextTick();
  expect(
    (wrapper.get('[aria-label="Source name"]').element as HTMLInputElement)
      .value,
  ).toBe("Renamed");
  expect(wrapper.text()).toContain("The source changed");
  expect(wrapper.text()).not.toContain("Reload editor");
  store.model.sourceEditor = {
    ...store.model.sourceEditor!,
    status: "loading",
    destinations: [],
  };
  await nextTick();
  expect(wrapper.find("form").exists()).toBe(false);
  wrapper.unmount();
});
it("uses the settings-selected destination without a Save in control", async () => {
  const { store, wrapper, requests } = await fixture(true, false);
  expect(
    wrapper.get('[aria-label="Edit Local"]').attributes("disabled"),
  ).toBeDefined();
  expect(wrapper.find("select").exists()).toBe(false);
  store.model.sourceEditor!.destinations[1]!.suggested = true;
  await nextTick();
  await wrapper.get('[aria-label="Enable Local"]').setValue(false);
  expect(requests()[0].request).toMatchObject({
    destinationId: "/user/NuGet.Config",
    destinationRevision: "user-old",
    edit: { enabled: false, url: "/workspace/packages" },
  });
  expect(
    (wrapper.get('[aria-label="Enable Local"]').element as HTMLInputElement)
      .checked,
  ).toBe(true);
  wrapper.unmount();
});
it("only clears drafts for the matching saved request and prevents duplicate submissions", async () => {
  const { store, wrapper, requests } = await fixture();
  await wrapper.get('[aria-label="Edit Local"]').trigger("click");
  await wrapper.get("form").trigger("submit");
  await wrapper.get("form").trigger("submit");
  expect(requests()).toHaveLength(1);
  store.model.sourceEditor = {
    ...store.model.sourceEditor!,
    status: "saved",
    requestId: "unrelated",
  };
  await nextTick();
  expect(wrapper.find("form").exists()).toBe(true);
  store.model.sourceEditor = {
    ...store.model.sourceEditor!,
    requestId: requests()[0].request.requestId,
  };
  await nextTick();
  expect(wrapper.find("form").exists()).toBe(false);
  wrapper.unmount();
});
it("allows adding a feed to an empty configuration and clears removal when scope changes", async () => {
  const { store, wrapper } = await fixture();
  await wrapper.get('[aria-label="Remove Local"]').trigger("click");
  expect(wrapper.find('[aria-label="Remove source"]').exists()).toBe(true);
  store.model.sources[0]!.feeds = [];
  store.model.selectedTargetId = "another";
  await nextTick();
  expect(wrapper.find('[aria-label="Remove source"]').exists()).toBe(false);
  const add = wrapper
    .findAll("button")
    .find((button) => button.text() === "New feed")!;
  await add.trigger("click");
  expect(wrapper.find("form").exists()).toBe(true);
  wrapper.unmount();
});

it("preserves a failed draft through real same-context host state replacements", async () => {
  const { store, wrapper, requests } = await fixture();
  const disconnect = store.connect();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "state",
        sessionId: "sources-test",
        revision: 1,
        state: JSON.parse(JSON.stringify(store.model)),
      },
    }),
  );
  await nextTick();
  await wrapper.get('[aria-label="Edit Local"]').trigger("click");
  await wrapper.get('[aria-label="Source name"]').setValue("My draft");
  await wrapper.get("form").trigger("submit");
  const request = requests()[0].request;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "stateDelta",
        sessionId: "sources-test",
        revision: 2,
        baseRevision: 1,
        patch: {
          sourceEditor: {
            ...store.model.sourceEditor!,
            status: "failed",
            requestId: request.requestId,
            message: "File changed",
          },
        },
      },
    }),
  );
  await nextTick();
  expect(
    (wrapper.get('[aria-label="Source name"]').element as HTMLInputElement)
      .value,
  ).toBe("My draft");
  expect(
    wrapper.get('button[type="submit"]').attributes("disabled"),
  ).toBeUndefined();
  expect(wrapper.text()).toContain("File changed");
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "stateDelta",
        sessionId: "sources-test",
        revision: 3,
        baseRevision: 2,
        patch: { selectedTargetId: "different" },
      },
    }),
  );
  await nextTick();
  expect(wrapper.find("form").exists()).toBe(false);
  disconnect();
  wrapper.unmount();
});
