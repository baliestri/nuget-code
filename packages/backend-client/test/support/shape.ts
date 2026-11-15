import { expect } from "vitest";

/**
 * The expected form of a value from the backend. A key that ends in `?` may be absent. An array shape has
 * one element, the shape of every item.
 */
export type Shape = "string" | "number" | "boolean" | readonly [Shape] | { readonly [key: string]: Shape };

/**
 * Fails when a field is missing, has another type, or is not declared in the shape. The last one is what
 * catches a field the backend added and the TypeScript types do not know.
 */
export function expectShape(value: unknown, shape: Shape, path = "$"): void {
  if (typeof shape === "string") {
    expect(typeof value, `${path} should be a ${shape}`).toBe(shape);
    return;
  }

  if (Array.isArray(shape)) {
    expect(Array.isArray(value), `${path} should be an array`).toBe(true);
    (value as unknown[]).forEach((item, index) => expectShape(item, shape[0] as Shape, `${path}[${index}]`));
    return;
  }

  expect(typeof value === "object" && value !== null && !Array.isArray(value), `${path} should be an object`).toBe(
    true
  );
  const actual = value as Record<string, unknown>;
  const fields = shape as { readonly [key: string]: Shape };
  const declared = new Set<string>();
  for (const [key, fieldShape] of Object.entries(fields)) {
    const optional = key.endsWith("?");
    const name = optional ? key.slice(0, -1) : key;
    declared.add(name);
    if (name in actual) {
      expectShape(actual[name], fieldShape, `${path}.${name}`);
    } else {
      expect(optional, `${path}.${name} is missing`).toBe(true);
    }
  }

  const undeclared = Object.keys(actual).filter((key) => !declared.has(key));
  expect(undeclared, `${path} has fields the protocol types do not declare`).toEqual([]);
}
