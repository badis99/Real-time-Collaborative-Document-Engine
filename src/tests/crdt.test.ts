import { describe, it, expect } from "vitest";
import { CrdtDocument, SENTINEL_ID } from "../modules/crdt/document";
import { deserialize, serialize } from "../modules/crdt/serialize";
import type { CharId, CharNode, CrdtOperation } from "../modules/crdt/types";

function id(clientId: string, clock: number): CharId {
  return { clientId, clock };
}

function char(
  clientId: string,
  clock: number,
  value: string,
  afterId: CharId | null
): CharNode {
  return {
    id: id(clientId, clock),
    afterId,
    value,
    deleted: false,
  };
}

describe("CRDT Question 1 — concurrent insert tiebreak", () => {
  it("bob goes left of alice when both insert after the same afterId", () => {
    const doc = new CrdtDocument();

    const aliceChar = char("alice", 1, "A", SENTINEL_ID);
    const bobChar = char("bob", 1, "B", SENTINEL_ID);

    // Both reference the same anchor (root). This is a true sibling tie case.
    doc.insert({ char: aliceChar, afterId: SENTINEL_ID });
    doc.insert({ char: bobChar, afterId: SENTINEL_ID });

    // Tiebreak rule: when siblings share the same afterId AND same Lamport clock,
    // higher clientId sorts first. "bob" > "alice", so bob is left.
    expect(doc.toText()).toBe("BA");
  });
});

describe("CRDT Question 2 — insert after deleted anchor", () => {
  it("still inserts Y after deleted X because X remains as tombstone anchor", () => {
    const doc = new CrdtDocument();

    const x = char("alice", 1, "X", SENTINEL_ID);
    doc.insert({ char: x, afterId: SENTINEL_ID });

    // X becomes tombstone (deleted=true) but stays in the structure.
    doc.delete(x.id);

    const y = char("carol", 1, "Y", x.id);
    doc.insert({ char: y, afterId: x.id });

    // X is hidden from text, but Y still resolves against X's id.
    expect(doc.toText()).toBe("Y");

    const state = doc.toState();
    const xNode = state.find(
      n => n.id.clientId === "alice" && n.id.clock === 1
    );
    const yNode = state.find(
      n => n.id.clientId === "carol" && n.id.clock === 1
    );

    expect(xNode?.deleted).toBe(true);
    expect(yNode?.afterId).toEqual(x.id);
  });
});

describe("CRDT Question 3 — out-of-order Lamport clocks", () => {
  it("merge applies inserts by Lamport clock ascending: [3, 5, 7]", () => {
    const doc = new CrdtDocument();

    // Delivered out of order to merge: clocks [5, 3, 7]
    const ops: CrdtOperation[] = [
      { type: "insert", afterId: SENTINEL_ID, char: char("u1", 5, "5", SENTINEL_ID) },
      { type: "insert", afterId: SENTINEL_ID, char: char("u2", 3, "3", SENTINEL_ID) },
      { type: "insert", afterId: SENTINEL_ID, char: char("u3", 7, "7", SENTINEL_ID) },
    ];

    doc.merge(ops);

    const allValuesInStorageOrder = doc
      .toState()
      .filter(n => !(n.id.clientId === "__root__" && n.id.clock === 0))
      .map(n => n.value)
      .join("");

    // Lamport sort decides apply order for merge.
    // Insert tiebreak then decides sibling placement at same anchor.
    expect(allValuesInStorageOrder.length).toBe(3);
    expect(doc.toText()).toBe("357");
  });

  it("clock 5 stays left of clock 7 even if received in reverse order", () => {
    const doc = new CrdtDocument();

    doc.insert({ char: char("u7", 7, "Y", SENTINEL_ID), afterId: SENTINEL_ID });
    doc.insert({ char: char("u5", 5, "X", SENTINEL_ID), afterId: SENTINEL_ID });

    expect(doc.toText()).toBe("XY");
  });
});

describe("CRDT additional coverage", () => {
  it("delete of unknown id is a no-op", () => {
    const doc = new CrdtDocument();
    doc.delete(id("nobody", 999));
    expect(doc.toText()).toBe("");
  });

  it("insert with missing afterId falls back to append", () => {
    const doc = new CrdtDocument();

    const orphanAnchor = id("ghost", 42);
    doc.insert({ char: char("alice", 1, "A", orphanAnchor), afterId: orphanAnchor });
    doc.insert({ char: char("bob", 1, "B", SENTINEL_ID), afterId: SENTINEL_ID });

    // First insert appends because anchor wasn't found.
    // Then root-sibling ordering places bob before alice.
    expect(doc.toText()).toBe("BA");
  });

  it("fromState recreates document text exactly", () => {
    const original = new CrdtDocument();
    original.insert({ char: char("alice", 1, "H", SENTINEL_ID), afterId: SENTINEL_ID });
    original.insert({ char: char("alice", 2, "i", id("alice", 1)), afterId: id("alice", 1) });

    const snapshot = original.toState();
    const restored = CrdtDocument.fromState(snapshot);

    expect(restored.toText()).toBe(original.toText());
  });

  it("same client same anchor keeps lower clock first", () => {
    const doc = new CrdtDocument();

    doc.insert({ char: char("alice", 1, "a", SENTINEL_ID), afterId: SENTINEL_ID });
    doc.insert({ char: char("alice", 2, "b", SENTINEL_ID), afterId: SENTINEL_ID });

    expect(doc.toText()).toBe("ab");
  });

  it("serialize/deserialize round-trip preserves state", () => {
    const doc = new CrdtDocument();
    doc.insert({ char: char("alice", 1, "H", SENTINEL_ID), afterId: SENTINEL_ID });
    doc.insert({ char: char("alice", 2, "i", id("alice", 1)), afterId: id("alice", 1) });

    const json = serialize(doc.toState());
    const state = deserialize(json);

    expect(state).toEqual(doc.toState());
  });

  it("deserialize rejects non-array payloads", () => {
    expect(() => deserialize("{\"a\":1}"))
      .toThrow("Invalid serialized CRDT state");
  });

  it("deserialize rejects malformed node payloads", () => {
    const bad = JSON.stringify([
      {
        id: { clientId: "alice", clock: 1 },
        afterId: null,
        value: "X",
      },
    ]);

    expect(() => deserialize(bad)).toThrow("Invalid serialized CRDT state");
  });
});
