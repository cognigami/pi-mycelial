import { CorruptionError } from "./identifiers";

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
export function parseJson<T>(
  text: string,
  path: string,
  validate: (value: unknown) => T
): T {
  try {
    return validate(JSON.parse(text));
  } catch (error) {
    if (error instanceof CorruptionError) throw error;
    throw new CorruptionError(
      path,
      error instanceof Error ? error.message : String(error)
    );
  }
}
