import { describe, it, expect } from "vitest";
import { CrdtDocument, SENTINEL_ID } from "../modules/crdt/document";
import type {
  CharId,
  CharNode,
  CrdtWireOperation,
  InsertWireOp,
  DeleteWireOp,
} from "../modules/crdt/types";

type IntentInsert = {
  type: "insert";
  clientId: string;
  startClock: number;
  position: number;
  text: string;
};

type IntentDelete = {
  type: "delete";
  clientId: string;
  position: number;
  length: number;
};

type IntentOp = IntentInsert | IntentDelete;

function isSentinel(id: CharId): boolean {
  return id.clientId === SENTINEL_ID.clientId && id.clock === SENTINEL_ID.clock;
}

function cloneState(state: CharNode[]): CharNode[] {
  return JSON.parse(JSON.stringify(state)) as CharNode[];
}

function visibleNodes(state: CharNode[]): CharNode[] {
  return state.filter(n => !n.deleted && !isSentinel(n.id));
}

function applyWireOp(doc: CrdtDocument, op: CrdtWireOperation): void {
  if (op.type === "insert") {
    const node: CharNode = {
      id: op.id,
      afterId: op.afterId,
      value: op.char,
      deleted: false,
    };
    doc.insert({ char: node, afterId: op.afterId });
    return;
  }

  doc.delete(op.id);
}

function seedDocument(initialText: string): CrdtDocument {
  const doc = new CrdtDocument();
  let afterId: CharId = SENTINEL_ID;

  for (let i = 0; i < initialText.length; i++) {
    const op: InsertWireOp = {
      type: "insert",
      id: { clientId: "__seed__", clock: i + 1 },
      afterId,
      char: initialText[i],
    };

    applyWireOp(doc, op);
    afterId = op.id;
  }

  return doc;
}

function planFromBase(baseState: CharNode[], intent: IntentOp): CrdtWireOperation[] {
  const baseVisible = visibleNodes(baseState);

  if (intent.type === "insert") {
    const boundedPos = Math.max(0, Math.min(intent.position, baseVisible.length));
    const afterId =
      boundedPos === 0 ? SENTINEL_ID : baseVisible[boundedPos - 1].id;

    return [
      {
        type: "insert",
        id: { clientId: intent.clientId, clock: intent.startClock },
        afterId,
        char: intent.text,
      },
    ];
  }

  const start = Math.max(0, intent.position);
  const end = Math.min(baseVisible.length, start + intent.length);
  const deletes: DeleteWireOp[] = [];

  for (let i = start; i < end; i++) {
    deletes.push({
      type: "delete",
      id: baseVisible[i].id,
    });
  }

  return deletes;
}

function applyPlannedOps(baseState: CharNode[], opLists: CrdtWireOperation[][]): string {
  const doc = CrdtDocument.fromState(cloneState(baseState));

  for (const ops of opLists) {
    for (const op of ops) {
      applyWireOp(doc, op);
    }
  }

  return doc.toText();
}

function assertConverges(initialText: string, opA: IntentOp, opB: IntentOp): void {
  const baseState = seedDocument(initialText).toState();
  const plannedA = planFromBase(baseState, opA);
  const plannedB = planFromBase(baseState, opB);

  const path1 = applyPlannedOps(baseState, [plannedA, plannedB]);
  const path2 = applyPlannedOps(baseState, [plannedB, plannedA]);

  expect(path1).toBe(path2);
}

function assertConvergesThree(
  initialText: string,
  opA: IntentOp,
  opB: IntentOp,
  opC: IntentOp
): void {
  const baseState = seedDocument(initialText).toState();
  const plannedA = planFromBase(baseState, opA);
  const plannedB = planFromBase(baseState, opB);
  const plannedC = planFromBase(baseState, opC);

  const resultABC = applyPlannedOps(baseState, [plannedA, plannedB, plannedC]);
  const resultCBA = applyPlannedOps(baseState, [plannedC, plannedB, plannedA]);
  const resultBAC = applyPlannedOps(baseState, [plannedB, plannedA, plannedC]);

  expect(resultABC).toBe(resultCBA);
  expect(resultABC).toBe(resultBAC);
}

describe("CRDT convergence — same structure as OT tests", () => {
  it("two users insert at different positions", () => {
    assertConverges(
      "Hello world",
      { type: "insert", clientId: "alice", startClock: 1, position: 5, text: "!" },
      { type: "insert", clientId: "bob", startClock: 1, position: 6, text: " beautiful" }
    );
  });

  it("two users insert at the same position", () => {
    assertConverges(
      "Hello world",
      { type: "insert", clientId: "alice", startClock: 1, position: 5, text: "AAA" },
      { type: "insert", clientId: "bob", startClock: 1, position: 5, text: "BBB" }
    );
  });

  it("one user inserts, one user deletes non-overlapping", () => {
    assertConverges(
      "Hello world",
      { type: "insert", clientId: "alice", startClock: 1, position: 0, text: ">>> " },
      { type: "delete", clientId: "bob", position: 6, length: 5 }
    );
  });

  it("one user inserts inside a range the other user deletes", () => {
    assertConverges(
      "Hello beautiful world",
      { type: "insert", clientId: "alice", startClock: 1, position: 10, text: "very " },
      { type: "delete", clientId: "bob", position: 6, length: 10 }
    );
  });

  it("two users delete overlapping ranges", () => {
    assertConverges(
      "Hello beautiful world",
      { type: "delete", clientId: "alice", position: 3, length: 8 },
      { type: "delete", clientId: "bob", position: 6, length: 7 }
    );
  });

  it("three-user case converges across different apply orders", () => {
    assertConvergesThree(
      "abcdefghij",
      { type: "insert", clientId: "alice", startClock: 1, position: 2, text: "XX" },
      { type: "delete", clientId: "bob", position: 4, length: 3 },
      { type: "insert", clientId: "carol", startClock: 1, position: 7, text: "YY" }
    );
  });
});

describe("CRDT Question checks", () => {
  it("Q1: same afterId tie uses clientId tiebreak (bob left of alice)", () => {
    const doc = new CrdtDocument();

    const opAlice: InsertWireOp = {
      type: "insert",
      id: { clientId: "alice", clock: 1 },
      afterId: SENTINEL_ID,
      char: "A",
    };
    const opBob: InsertWireOp = {
      type: "insert",
      id: { clientId: "bob", clock: 1 },
      afterId: SENTINEL_ID,
      char: "B",
    };

    applyWireOp(doc, opAlice);
    applyWireOp(doc, opBob);

    expect(doc.toText()).toBe("BA");
  });

  it("Q2: insert after deleted char still works via tombstone anchor", () => {
    const doc = new CrdtDocument();

    const x: InsertWireOp = {
      type: "insert",
      id: { clientId: "alice", clock: 1 },
      afterId: SENTINEL_ID,
      char: "X",
    };
    const deleteX: DeleteWireOp = {
      type: "delete",
      id: x.id,
    };
    const yAfterX: InsertWireOp = {
      type: "insert",
      id: { clientId: "carol", clock: 1 },
      afterId: x.id,
      char: "Y",
    };

    applyWireOp(doc, x);
    applyWireOp(doc, deleteX);
    applyWireOp(doc, yAfterX);

    expect(doc.toText()).toBe("Y");
  });

  it("Q3: out-of-order clocks [5, 3, 7] place 5 before 7", () => {
    const doc = new CrdtDocument();

    const ops: InsertWireOp[] = [
      { type: "insert", id: { clientId: "u5", clock: 5 }, afterId: SENTINEL_ID, char: "5" },
      { type: "insert", id: { clientId: "u3", clock: 3 }, afterId: SENTINEL_ID, char: "3" },
      { type: "insert", id: { clientId: "u7", clock: 7 }, afterId: SENTINEL_ID, char: "7" },
    ];

    // Received out of order; apply exactly in received order.
    for (const op of ops) {
      applyWireOp(doc, op);
    }

    const text = doc.toText();
    expect(text.indexOf("5")).toBeLessThan(text.indexOf("7"));
  });
});
