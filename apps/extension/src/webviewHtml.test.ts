import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, renderHtml } from "./webviewHtml";

const input = {
  scriptUri: "https://file+.vscode-resource.test/dist/webview/main.js",
  styleUri: "https://file+.vscode-resource.test/dist/webview/main.css",
  cspSource: "https://*.vscode-cdn.test",
  nonce: "abc123"
};

describe("contentSecurityPolicy", () => {
  it("allows only the bundle, and https images", () => {
    expect(contentSecurityPolicy(input.cspSource, input.nonce)).toBe(
      "default-src 'none'; img-src https://*.vscode-cdn.test https:; style-src https://*.vscode-cdn.test; " +
        "font-src https://*.vscode-cdn.test; script-src 'nonce-abc123'"
    );
  });

  it("allows no inline code, no evaluation and no network connection", () => {
    const policy = contentSecurityPolicy(input.cspSource, input.nonce);

    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("connect-src");
  });
});

describe("renderHtml", () => {
  const html = renderHtml(input);

  it("carries the policy", () => {
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(input.cspSource, input.nonce)}" />`
    );
  });

  it("loads the script with the nonce and the style sheet from the bundle", () => {
    expect(html).toContain(`<script nonce="abc123" src="${input.scriptUri}"></script>`);
    expect(html).toContain(`<link rel="stylesheet" href="${input.styleUri}" />`);
  });

  it("has no inline style or inline script", () => {
    expect(html).not.toMatch(/style\s*=/);
    expect(html).not.toContain("<style");
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});
