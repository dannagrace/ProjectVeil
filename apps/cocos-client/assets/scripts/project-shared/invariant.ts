export function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }

  return value;
}

export function withOptionalProperty<T extends object, K extends string, V>(
  value: T,
  key: K,
  optionalValue: V | undefined
): T & Partial<Record<K, V>> {
  if (optionalValue === undefined) {
    return value;
  }

  return {
    ...value,
    [key]: optionalValue
  } as T & Partial<Record<K, V>>;
}
