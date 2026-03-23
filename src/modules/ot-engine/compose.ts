import { Operation } from "./types";
import { applyOp } from "./apply";

export function compose(opA: Operation, opB: Operation): Operation | [Operation, Operation] {
  if (
    opA.type === "insert" &&
    opB.type === "insert" &&
    opB.position === opA.position + opA.text.length
  ) {
    return {
      type:     "insert",
      position: opA.position,
      text:     opA.text + opB.text,
    };
  }

  if (
    opA.type === "delete" &&
    opB.type === "delete" &&
    opA.position === opB.position
  ) {
    return {
      type:     "delete",
      position: opA.position,
      length:   opA.length + opB.length,
    };
  }

  return [opA, opB];
}

export function applyAll(content: string, ops: Operation[]): string {
  return ops.reduce((doc, op) => applyOp(doc, op), content);
}