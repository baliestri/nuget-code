export function readBoolean(key: string, fallback: boolean): boolean {
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

export function writeBoolean(key: string, value: boolean): void {
  window.localStorage.setItem(key, String(value));
}

export function readString<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  const stored = window.localStorage.getItem(key);
  return allowed.includes(stored as T) ? (stored as T) : fallback;
}

export function writeString<T extends string>(key: string, value: T): void {
  window.localStorage.setItem(key, value);
}

export function readStringList<T extends string>(
  key: string,
  fallback: T[],
  allowed: readonly T[],
): T[] {
  const stored = window.localStorage.getItem(key);
  if (!stored) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const values = parsed.filter((item): item is T =>
      allowed.includes(item as T),
    );
    return values.length > 0 ? values : fallback;
  } catch {
    return fallback;
  }
}

export function writeStringList<T extends string>(
  key: string,
  value: T[],
): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}
