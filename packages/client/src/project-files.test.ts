import { expect, it } from "vitest";
import { decodeProjectText, encodeProjectText } from "./project-files";

it.each(["utf8", "utf16le", "utf16be"] as const)(
  "preserves BOM, Unicode and line endings in %s",
  (encoding) => {
    const text = "\ufeff<Project>\r\n<!-- versão 💡 -->\r\n</Project>\r\n";
    const bytes = encodeProjectText({ text, encoding });
    const decoded = decodeProjectText(bytes);
    expect(decoded).toEqual({ text, encoding });
    expect(encodeProjectText(decoded)).toEqual(bytes);
  },
);

it("rejects unsupported or misleading encoding declarations", () => {
  expect(() =>
    decodeProjectText(
      Buffer.from('<?xml version="1.0" encoding="windows-1252"?><Project/>'),
    ),
  ).toThrow();
  expect(() =>
    decodeProjectText(
      Buffer.from('<?xml version="1.0" encoding="utf-16"?><Project/>'),
    ),
  ).toThrow();
});
