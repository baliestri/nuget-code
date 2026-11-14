/*
 * The view in a browser, over a fake host with sample data. For looking at the interface without the
 * editor: `pnpm --filter @nuget-code/webview dev:page`, then http://127.0.0.1:5199.
 *
 *   ?theme=light        the light theme
 *   ?state=starting     no answer from the host yet
 *   ?state=stopped      the backend is not running
 *   ?state=none         no solution selected
 *   ?state=nosdk        no .NET SDK
 */
import { createRoot } from "react-dom/client";
import { Root } from "../src/app/Root";
import { createFakeBridge, createMemoryStorage, READY } from "../test/fakeBridge";
import { installSampleData, SESSION } from "./sampleData";

const query = new URLSearchParams(window.location.search);
if (query.get("theme") === "light") {
  document.documentElement.dataset["theme"] = "light";
}

const sessions = {
  starting: null,
  stopped: { ...READY, backend: "stopped" as const },
  none: READY,
  nosdk: { ...SESSION, hasSdk: false }
};
const state = query.get("state");
const fake = createFakeBridge(state !== null && state in sessions ? sessions[state as keyof typeof sessions] : SESSION);
installSampleData(fake);

// The page can be driven from the console, or by whoever is taking screenshots.
Object.assign(window, { fake });

// ?click=<accessible names, separated by |> presses those controls in turn once the page has settled, so a
// screenshot can show a state that takes interaction to reach.
const clicks = (query.get("click") ?? "").split("|").filter((name) => name !== "");
if (clicks.length > 0) {
  const press = (index: number): void => {
    const name = clicks[index];
    if (name === undefined) {
      return;
    }

    const controls = [...document.querySelectorAll<HTMLElement>("button, input, [role=tab]")];
    const control = controls.find((element) =>
      (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().startsWith(name)
    );
    control?.click();
    setTimeout(() => press(index + 1), 250);
  };
  setTimeout(() => press(0), 600);
}

const stored = query.get("prefs");
createRoot(document.getElementById("root")!).render(
  <Root client={fake.client} storage={createMemoryStorage(stored === null ? undefined : JSON.parse(stored))} />
);
