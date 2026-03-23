import { Operation, InsertOp, DeleteOp } from "./types";

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