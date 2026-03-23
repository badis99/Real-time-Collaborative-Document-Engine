import { describe, it, expect } from "vitest";
import { applyOp }   from "../modules/ot-engine/apply";
import { transform } from "../modules/ot-engine/transform";
import { applyAll }  from "../modules/ot-engine/compose";
import type { InsertOp, DeleteOp } from "../modules/ot-engine/types";

const ins = (position: number, text: string): InsertOp =>
  ({ type: "insert", position, text });

const del = (position: number, length: number): DeleteOp =>
  ({ type: "delete", position, length });

// The core correctness property of OT:
// Applying opA then transform(opB, opA) must equal
// applying opB then transform(opA, opB).
// Both paths must converge on the same document.
function assertConverges(doc: string, opA: InsertOp | DeleteOp, opB: InsertOp | DeleteOp) {
  const path1 = applyOp(applyOp(doc, opA), transform(opB, opA));
  const path2 = applyOp(applyOp(doc, opB), transform(opA, opB));
  expect(path1).toBe(path2);
}

describe("applyOp — insert", () => {
  it("inserts at position 0", () => {
    expect(applyOp("world", ins(0, "Hello "))).toBe("Hello world");
  });

  it("inserts in the middle", () => {
    expect(applyOp("Hello world", ins(6, "beautiful "))).toBe("Hello beautiful world");
  });

  it("inserts at the end", () => {
    expect(applyOp("Hello", ins(5, "!"))).toBe("Hello!");
  });

  it("inserts into an empty string", () => {
    expect(applyOp("", ins(0, "hi"))).toBe("hi");
  });
});

describe("applyOp — delete", () => {
  it("deletes from the start", () => {
    expect(applyOp("Hello world", del(0, 6))).toBe("world");
  });

  it("deletes from the middle", () => {
    expect(applyOp("Hello beautiful world", del(6, 10))).toBe("Hello world");
  });

  it("deletes to the end", () => {
    expect(applyOp("Hello world", del(5, 6))).toBe("Hello");
  });

  it("deletes the whole string", () => {
    expect(applyOp("Hello", del(0, 5))).toBe("");
  });

  it("deletes a single character", () => {
    expect(applyOp("Hello", del(4, 1))).toBe("Hell");
  });
});

// ── transform: insert vs insert ───────────────────────────────────────────────

describe("transform — insert vs insert", () => {
  const doc = "Hello world";

  it("opA before opB — opA position unchanged", () => {
    const opA = ins(2, "XY");   // before position 6
    const opB = ins(6, "!!!");
    const opA2 = transform(opA, opB) as InsertOp;
    expect(opA2.position).toBe(2);
    assertConverges(doc, opA, opB);
  });

  it("opA after opB — opA shifts right by opB text length", () => {
    const opA = ins(8, "XY");
    const opB = ins(3, "!!!");   
    const opA2 = transform(opA, opB) as InsertOp;
    expect(opA2.position).toBe(11);  
    assertConverges(doc, opA, opB);
  });

  it("opA at same position as opB — deterministic tiebreak keeps convergence", () => {
    const opA = ins(5, "AA");
    const opB = ins(5, "BB");
    const opA2 = transform(opA, opB) as InsertOp;
    expect(opA2.position).toBe(5);
    assertConverges(doc, opA, opB);
  });

  it("text content is preserved after transform", () => {
    const opA = ins(8, "XY");
    const opB = ins(3, "!!!");
    const opA2 = transform(opA, opB) as InsertOp;
    expect(opA2.text).toBe("XY");
  });
});

// ── transform: insert vs delete ───────────────────────────────────────────────

describe("transform — insert vs delete", () => {
  const doc = "Hello beautiful world";  

  it("insert before deleted range — unchanged", () => {
    const opA = ins(2, "XY");
    const opB = del(10, 5);             
    const opA2 = transform(opA, opB) as InsertOp;
    expect(opA2.position).toBe(2);
    assertConverges(doc, opA, opB);
  });

  it("insert inside deleted range — clamps to delete start", () => {
    const opA = ins(12, "XY");          
    const opB = del(10, 5);
    const opA2 = transform(opA, opB) as InsertOp;
    expect(opA2.position).toBe(10);     
    assertConverges(doc, opA, opB);
  });

  it("insert after deleted range — shifts left by delete length", () => {
    const opA = ins(18, "XY");
    const opB = del(6, 10);             
    const opA2 = transform(opA, opB) as InsertOp;
    expect(opA2.position).toBe(8);      
    assertConverges(doc, opA, opB);
  });
});

// ── transform: delete vs insert ───────────────────────────────────────────────

describe("transform — delete vs insert", () => {
  const doc = "Hello world";

  it("delete before insert — unchanged", () => {
    const opA = del(0, 3);
    const opB = ins(8, "!!!");
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(0);
    expect(opA2.length).toBe(3);
    assertConverges(doc, opA, opB);
  });

  it("delete after insert — shifts right by insert length", () => {
    const opA = del(7, 3);
    const opB = ins(2, "XY");           
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(9);      
    expect(opA2.length).toBe(3);
    assertConverges(doc, opA, opB);
  });

  it("insert lands inside delete range — delete absorbs inserted text", () => {
    const opA = del(3, 6);             
    const opB = ins(5, "!!!");         
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(3);
    expect(opA2.length).toBe(9);
    assertConverges(doc, opA, opB);
  });
});

// ── transform: delete vs delete ───────────────────────────────────────────────

describe("transform — delete vs delete", () => {
  const doc = "Hello beautiful world";

  it("non-overlapping: opA before opB — unchanged", () => {
    const opA = del(0, 3);
    const opB = del(10, 4);
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(0);
    expect(opA2.length).toBe(3);
    assertConverges(doc, opA, opB);
  });

  it("non-overlapping: opA after opB — shifts left by opB length", () => {
    const opA = del(14, 3);
    const opB = del(5, 6);
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(8);     
    expect(opA2.length).toBe(3);
    assertConverges(doc, opA, opB);
  });

  it("opB entirely contains opA — opA becomes a no-op", () => {
    const opA = del(4, 3);             
    const opB = del(2, 10);
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.length).toBe(0);      
    assertConverges(doc, opA, opB);
  });

  it("opA entirely contains opB — opA shrinks by opB length", () => {
    const opA = del(2, 12);
    const opB = del(5, 4);             
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(2);
    expect(opA2.length).toBe(8);       
    assertConverges(doc, opA, opB);
  });

  it("partial overlap: opA starts before opB", () => {
    const opA = del(3, 7);             
    const opB = del(6, 5);             
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(3);
    expect(opA2.length).toBe(3);       
    assertConverges(doc, opA, opB);
  });

  it("partial overlap: opA starts inside opB", () => {
    const opA = del(6, 6);             
    const opB = del(3, 5);             
    const opA2 = transform(opA, opB) as DeleteOp;
    expect(opA2.position).toBe(3);
    expect(opA2.length).toBe(4);       
    assertConverges(doc, opA, opB);
  });
});

describe("convergence — real editing scenarios", () => {

  it("two users insert at different positions", () => {
    const doc  = "Hello world";
    const opA  = ins(5, "!");           
    const opB  = ins(6, " beautiful");  
    assertConverges(doc, opA, opB);
  });

  it("two users insert at the same position", () => {
    const doc  = "Hello world";
    const opA  = ins(5, "AAA");
    const opB  = ins(5, "BBB");
    assertConverges(doc, opA, opB);
  });

  it("one user inserts, one user deletes non-overlapping", () => {
    const doc  = "Hello world";
    const opA  = ins(0, ">>> ");        
    const opB  = del(6, 5);            
    assertConverges(doc, opA, opB);
  });

  it("one user inserts inside a range the other user deletes", () => {
    const doc  = "Hello beautiful world";
    const opA  = ins(10, "very ");
    const opB  = del(6, 10);           
    assertConverges(doc, opA, opB);
  });

  it("two users delete overlapping ranges", () => {
    const doc  = "Hello beautiful world";
    const opA  = del(3, 8);
    const opB  = del(6, 7);
    assertConverges(doc, opA, opB);
  });

  it("chain of three ops all converge", () => {
    const doc  = "abcdefghij";
    const opA  = ins(2, "XX");
    const opB  = del(4, 3);
    const opC  = ins(7, "YY");

    const docAfterA  = applyOp(doc, opA);
    const opB_afterA = transform(opB, opA);
    const docAfterAB = applyOp(docAfterA, opB_afterA);
    const opC_afterB = transform(transform(opC, opA), opB_afterA);
    const result1    = applyOp(docAfterAB, opC_afterB);

    const docAfterB  = applyOp(doc, opB);
    const opA_afterB = transform(opA, opB);
    const docAfterBA = applyOp(docAfterB, opA_afterB);
    const opC_afterA = transform(transform(opC, opB), opA_afterB);
    const result2    = applyOp(docAfterBA, opC_afterA);

    expect(result1).toBe(result2);
  });
});

// ── applyAll ──────────────────────────────────────────────────────────────────

describe("applyAll", () => {
  it("applies a sequence of ops in order", () => {
    const doc  = "Hello world";
    const ops  = [ins(5, "!"), ins(0, ">>> "), del(10, 5)];
    const result = applyAll(doc, ops);
    expect(typeof result).toBe("string");
  });

  it("empty op list returns original", () => {
    expect(applyAll("Hello", [])).toBe("Hello");
  });
});