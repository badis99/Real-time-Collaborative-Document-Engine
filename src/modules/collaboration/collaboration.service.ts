import { documentRepository } from "../documents/document.repository";
import { db } from "../../config/db";
import { CrdtDocument } from "../crdt/document";
import type { CharNode, CrdtWireOperation } from "../crdt/types";

export type ApplyResult =
  | { ok: true; appliedOp: CrdtWireOperation; newVersion: number }
  | { ok: false; error: string };

function applyWireOperation(doc: CrdtDocument, op: CrdtWireOperation): void {
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

export const collaborationService = {

  async applyOperation({
    docId,
    op,
    userId,
  }: {
    docId:  string;
    op:     CrdtWireOperation;
    userId: string;
  }): Promise<ApplyResult> {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const doc = await documentRepository.findByIdForUpdate(docId, client);

      if (!doc) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Document not found" };
      }

      const existingOps = await documentRepository.getOperationsForDocument(docId);
      const crdt = new CrdtDocument();

      for (const existing of existingOps) {
        applyWireOperation(crdt, existing.op);
      }

      applyWireOperation(crdt, op);

      const newContent = crdt.toText();
      const newVersion = doc.version + 1;

      await documentRepository.insertOperation(
        docId,
        newVersion,
        op,
        userId,
        client
      );

      await documentRepository.updateContentAndVersion(
        docId,
        newContent,
        newVersion,
        client
      );

      await client.query("COMMIT");

      return { ok: true, appliedOp: op, newVersion };

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("applyOperation failed:", err);
      return { ok: false, error: "Failed to apply operation" };

    } finally {
      client.release();
    }
  },

  async getDocumentState(
    docId: string
  ): Promise<{
    state: CharNode[];
    version: number;
  }> {
    const doc = await documentRepository.findById(docId);
    if (!doc) throw new Error("Document not found");

    const operations = await documentRepository.getOperationsForDocument(docId);
    const crdt = new CrdtDocument();

    for (const operation of operations) {
      applyWireOperation(crdt, operation.op);
    }

    return {
      state: crdt.toState(),
      version: doc.version,
    };
  },
};