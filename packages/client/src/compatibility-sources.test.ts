import { expect, it } from "vitest";
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import { restrictCompatibilitySources } from "./compatibility-sources";

const sources =
  '<packageSources><clear/><add key="a" value="https://a.test/v3/index.json"/><add key="b" value="https://b.test/v3/index.json"/></packageSources>';
const feeds = ["https://a.test/v3/index.json", "https://b.test/v3/index.json"];
function rules(text: string) {
  const children = (node: XmlElement) =>
    node.children.filter(
      (child): child is XmlElement => child instanceof XmlElement,
    );
  const mapping = children(parseXml(text).root!).find(
    (node) => node.name === "packageSourceMapping",
  )!;
  return Object.fromEntries(
    children(mapping).map((node) => [
      node.attributes.key,
      children(node).map((rule) => rule.attributes.pattern),
    ]),
  );
}
it("restricts only the target and preserves dependency sources", () => {
  expect(
    rules(
      restrictCompatibilitySources(
        `<configuration>${sources}</configuration>`,
        "Demo",
        feeds,
        [feeds[1]!],
      ),
    ),
  ).toEqual({ a: ["*"], b: ["*", "Demo"] });
});
it("intersects existing highest-precedence rules without broadening them", () => {
  const xml = `<configuration>${sources}<packageSourceMapping><packageSource key="a"><package pattern="Demo"/><package pattern="Private.*"/></packageSource><packageSource key="b"><package pattern="*"/></packageSource></packageSourceMapping></configuration>`;
  expect(() =>
    restrictCompatibilitySources(xml, "Demo", feeds, [feeds[1]!]),
  ).toThrow();
  expect(
    rules(restrictCompatibilitySources(xml, "Demo", feeds, feeds)),
  ).toEqual({ a: ["Private.*", "Demo"], b: ["*"] });
});
it("respects longest-prefix precedence and disabled sources", () => {
  const xml = `<configuration>${sources}<packageSourceMapping><packageSource key="a"><package pattern="Demo.*"/></packageSource><packageSource key="b"><package pattern="D*"/></packageSource></packageSourceMapping></configuration>`;
  expect(() =>
    restrictCompatibilitySources(xml, "Demo.Core", feeds, [feeds[1]!]),
  ).toThrow();
  expect(() =>
    restrictCompatibilitySources(
      `<configuration>${sources}<disabledPackageSources><add key="b" value="true"/></disabledPackageSources></configuration>`,
      "Demo",
      feeds,
      [feeds[1]!],
    ),
  ).toThrow();
});
it("rejects unauthorized sources and fallback stores", () => {
  expect(() =>
    restrictCompatibilitySources(
      `<configuration>${sources}</configuration>`,
      "Demo",
      [feeds[0]!],
      [feeds[0]!],
    ),
  ).toThrow();
  expect(() =>
    restrictCompatibilitySources(
      `<configuration>${sources}<fallbackPackageFolders><add key="old" value="elsewhere"/></fallbackPackageFolders></configuration>`,
      "Demo",
      feeds,
      feeds,
    ),
  ).toThrow();
});
