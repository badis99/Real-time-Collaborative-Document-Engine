import { Operation, InsertOp, DeleteOp } from "./types";

// ── transform(opA, opB) → opA′ ────────────────────────────────────────────────
//
// Both opA and opB were created against the same document version.
// opB was applied to the document first.
// Returns a new version of opA that produces the correct result
// when applied after opB.
//
// Tiebreaker rule: when two inserts land at the exact same position,
// opB is treated as having priority — opA shifts one step to the right.
// This matches the "server wins" model: the op that arrived at the server
// first (opB) keeps its position; the late-arriving op (opA) adjusts.

export function transform(opA: Operation, opB: Operation): Operation {
  switch (opA.type) {
    case "insert":
      switch (opB.type) {
        case "insert": return transformInsertInsert(opA, opB);
        case "delete": return transformInsertDelete(opA, opB);
      }
    case "delete":
      switch (opB.type) {
        case "insert": return transformDeleteInsert(opA, opB);
        case "delete": return transformDeleteDelete(opA, opB);
      }
  }
}

// ── Case 1: insert vs insert ──────────────────────────────────────────────────
//
// opB inserted text somewhere in the document.
// Does that shift where opA needs to land?
//
// Rule:
//   - opB inserted BEFORE opA's position → opA shifts right by opB.text.length
//   - opB inserted AFTER  opA's position → opA position unchanged
//   - opB inserted AT the same position  → opA shifts right (tiebreaker: opB wins)
//
// Example:
//   doc = "Hello world"
//   opA = insert(5, "!")      → wants "Hello! world"
//   opB = insert(0, "Say: ")  → applied first → doc = "Say: Hello world"
//
//   opB inserted 5 chars before position 5, so opA shifts to insert(10, "!")
//   result: "Say: Hello! world"  ✓

function transformInsertInsert(opA: InsertOp, opB: InsertOp): InsertOp {
  if (opB.position < opA.position) {
    return { 
        type: "insert", 
        position: opA.position + opB.text.length, 
        text: opA.text 
    };
  }

  if (opB.position === opA.position) {
    if (opB.text <= opA.text) {
      return { 
        type: "insert", 
        position: opA.position + opB.text.length, 
        text: opA.text 
        };
    }
    return opA;
  }

  return opA;
}

// ── Case 2: insert vs delete ──────────────────────────────────────────────────
//
// opB deleted a range. Does that shift where opA's insert needs to land?
//
// Three sub-cases based on where opA.position falls relative to the deleted range:
//
//   [  deleted range  ]
//    ^                ^
//    opB.position     opB.position + opB.length
//
// Sub-case A: opA is BEFORE the deleted range → unchanged
// Sub-case B: opA is INSIDE the deleted range → clamp to the start of the deletion
//             (the characters opA was targeting are gone; land at the nearest safe spot)
// Sub-case C: opA is AFTER  the deleted range → shift left by opB.length
//
// Example (sub-case C):
//   doc = "Hello beautiful world"
//   opA = insert(20, "!")     → wants "Hello beautiful world!"
//   opB = delete(6, 10)       → applied first → doc = "Hello world"
//
//   opB deleted 10 chars before position 20, so opA shifts to insert(10, "!")
//   result: "Hello world!"  ✓

function transformInsertDelete(opA: InsertOp, opB: DeleteOp): InsertOp {
  const deleteEnd = opB.position + opB.length;
    const insertEnd = opA.position + opA.text.length;

  if (opA.position <= opB.position) {
    return opA;
  }

  if (opA.position < deleteEnd) {
    if(insertEnd <= deleteEnd) {
        return {
            type : "insert",
            position : opB.position,
            text : ""
        };
    }
    return {
      type:     "insert",
      position: deleteEnd,
      text:     opA.text.slice(opA.text.length - (insertEnd - deleteEnd),opA.text.length),
    };
  }

  return {
    type:     "insert",
    position: opA.position - opB.length,
    text:     opA.text,
  };
}

// ── Case 3: delete vs insert ──────────────────────────────────────────────────
//
// opB inserted text somewhere. Does that shift opA's delete position or length?
//
// Two sub-cases:
//
// Sub-case A: opB inserted BEFORE opA's delete start
//   → opA shifts right by opB.text.length (the whole range moved)
//
// Sub-case B: opB inserted INSIDE opA's deleted range
//   → opA's position unchanged, but its length grows by opB.text.length
//   (opA now has to delete the newly inserted text too, to have the same net effect)
//
// Sub-case C: opB inserted AFTER opA's deleted range
//   → opA unchanged
//
// Example (sub-case B):
//   doc = "Hello world"
//   opA = delete(0, 11)       → wants to delete everything
//   opB = insert(5, "!!!")    → applied first → doc = "Hello!!! world"
//
//   opB inserted 3 chars inside opA's range, so opA becomes delete(0, 14)
//   result: ""  ✓

function transformDeleteInsert(opA: DeleteOp, opB: InsertOp): DeleteOp {
  const deleteEnd = opA.position + opA.length;

  if (opB.position <= opA.position) {
    return {
      type:     "delete",
      position: opA.position + opB.text.length,
      length:   opA.length,
    };
  }

  if (opB.position < deleteEnd) {
    return {
      type:     "delete",
      position: opA.position,
      length:   opA.length + opB.text.length,
    };
  }

  return opA;
}

// ── Case 4: delete vs delete ──────────────────────────────────────────────────
//
// This is the most complex case. opB already deleted some characters.
// opA wanted to delete a different (or overlapping) range.
// We need to figure out what opA should do now that opB's range is gone.
//
// Visual aid — the original document positions:
//
//   opA range: [posA ──────────── posA + lenA)
//   opB range: [posB ──────────── posB + lenB)
//
// Five sub-cases:
//
//   1. opA entirely BEFORE opB → opA unchanged
//   2. opA entirely AFTER  opB → opA shifts left by opB.length
//   3. opB entirely CONTAINS opA → opA becomes a no-op (length 0)
//      (everything opA wanted to delete is already gone)
//   4. opA entirely CONTAINS opB → opA shrinks by opB.length
//      (opA still deletes its range minus the part opB already handled)
//   5. PARTIAL overlap → trim the overlapping part from opA
//
// Example (sub-case 3 — opB contains opA):
//   doc = "Hello world"
//   opA = delete(2, 3)        → wanted to delete "llo"
//   opB = delete(1, 8)        → applied first, deleted "ello wor" → doc = "Hld"
//
//   opA's entire range is already gone → becomes delete(1, 0) — a no-op
//
// Example (sub-case 5 — partial overlap):
//   doc = "Hello world"
//   opA = delete(3, 5)        → wanted to delete "lo wo"  (positions 3-7)
//   opB = delete(5, 4)        → applied first, deleted "worl" (positions 5-8)
//
//   Overlap: positions 5-7 were deleted by both
//   opA should now only delete positions 3-4 ("lo") — length shrinks to 2

function transformDeleteDelete(opA: DeleteOp, opB: DeleteOp): DeleteOp {
  const aStart = opA.position;
  const aEnd   = opA.position + opA.length;
  const bStart = opB.position;
  const bEnd   = opB.position + opB.length;

  if (aEnd <= bStart) {
    return opA;
  }

  if (aStart >= bEnd) {
    return {
      type:     "delete",
      position: opA.position - opB.length,
      length:   opA.length,
    };
  }

  if (bStart <= aStart && bEnd >= aEnd) {
    return {
      type:     "delete",
      position: bStart,
      length:   0,
    };
  }

  if (aStart <= bStart && aEnd >= bEnd) {
    return {
      type:     "delete",
      position: aStart,
      length:   opA.length - opB.length,
    };
  }

  if (aStart < bStart) {
    return {
      type:     "delete",
      position: aStart,
      length:   bStart - aStart,
    };
  } else {
    return {
      type:     "delete",
      position: bStart,
      length:   aEnd - bEnd,
    };
  }
}