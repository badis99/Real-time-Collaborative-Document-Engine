import { Operation } from "./types";

export function applyOp(content: string, op: Operation): string {
  switch (op.type) {

    case "insert":
      return (
        content.slice(0, op.position) +
        op.text +
        content.slice(op.position)
      );

    case "delete":
      return (
        content.slice(0, op.position) +
        content.slice(op.position + op.length)
      );
  }
}