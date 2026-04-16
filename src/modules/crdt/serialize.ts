import type { CharId, CharNode } from "./types";

function isCharId(value: unknown): value is CharId {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CharId>;
  return (
    typeof candidate.clientId === "string" &&
    typeof candidate.clock === "number"
  );
}

function isCharNode(value: unknown): value is CharNode {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CharNode>;
  const afterIdIsValid =
    candidate.afterId === null || isCharId(candidate.afterId);

  return (
    isCharId(candidate.id) &&
    afterIdIsValid &&
    typeof candidate.value === "string" &&
    typeof candidate.deleted === "boolean"
  );
}

export function serialize(state: CharNode[]): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): CharNode[] {
  const parsed: unknown = JSON.parse(json);

  if (!Array.isArray(parsed) || !parsed.every(isCharNode)) {
    throw new Error("Invalid serialized CRDT state");
  }

  return parsed;
}
