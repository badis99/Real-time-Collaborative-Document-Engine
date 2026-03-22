import { db } from "../../config/db";
import { documentRepository } from "../documents/document.repository";
import { transform } from "../ot-engine/transform";
import { applyOp }   from "../ot-engine/apply";
import type { Operation } from "../ot-engine/types";

export type ApplyResult =
  | { ok: true;  transformedOp: Operation; newVersion: number }
  | { ok: false; error: string };

export const collaborationService = {

  // ── applyOperation ────────────────────────────────────────────────────────
  // This is the heart of the entire project.
  //
  // Flow:
  //   1. Open a transaction and lock the document row (FOR UPDATE)
  //   2. Fetch all ops that arrived since the client's baseVersion
  //   3. Transform the incoming op against each missed op (OT algorithm)
  //   4. Apply the transformed op to the document content
  //   5. Persist the new op and updated document atomically
  //   6. Return the transformed op + new version to the handler
  //
  // The FOR UPDATE lock in step 1 means only one operation can go through
  // this function at a time per document. Concurrent ops queue up and each
  // one sees the fully-committed state from the one before it.

  async applyOperation({
    docId,
    op,
    baseVersion,
    userId,
  }: {
    docId:       string;
    op:          Operation;
    baseVersion: number;
    userId:      string;
  }): Promise<ApplyResult> {

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const doc = await documentRepository.findByIdForUpdate(docId, client);

      if (!doc) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Document not found" };
      }

      // ── Step 2: Fetch missed operations ───────────────────────────────────
      // These are ops that were committed between when the client last synced
      // (baseVersion) and now (doc.version). We need to transform against them.
      const missedOps = await documentRepository.getOperationsSince(
        docId,
        baseVersion
      );

      // ── Step 3: Transform the incoming op ─────────────────────────────────
      // Apply OT: for each missed op, adjust the incoming op's position
      // so it applies correctly on top of the current document state.
      //
      // Example:
      //   baseVersion = 5, doc.version = 7
      //   missedOps = [op@v6, op@v7]
      //   incoming op = insert(10, "hello")
      //
      //   transform(insert(10), op@v6) → insert(8)    [v6 deleted 2 chars before pos 10]
      //   transform(insert(8),  op@v7) → insert(8)    [v7 inserted after pos 8, no shift]
      //   final transformedOp = insert(8, "hello")    ← safe to apply at v7

      let transformedOp = op;

      for (const missed of missedOps) {
        transformedOp = transform(transformedOp, missed.op as Operation);
      }

      const newContent = applyOp(doc.content, transformedOp);
      const newVersion = doc.version + 1;

      await documentRepository.insertOperation(
        docId,
        newVersion,
        transformedOp,
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

      return { ok: true, transformedOp, newVersion };

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("applyOperation failed:", err);
      return { ok: false, error: "Failed to apply operation" };

    } finally {
      client.release();
    }
  },

  // ── getCatchUpPayload ─────────────────────────────────────────────────────
  // Called when a client reconnects with a stale version.
  // Returns the ops they missed so they can replay them locally
  // rather than receiving the full document again.

  async getCatchUpPayload(
    docId:        string,
    sinceVersion: number
  ): Promise<{
    type:      "catch-up" | "full-state";
    content?:  string;
    missedOps?: { op: Operation; version: number; userId: string }[];
    version:   number;
  }> {
    const doc = await documentRepository.findById(docId);
    if (!doc) throw new Error("Document not found");

    const gap = doc.version - sinceVersion;

    if (sinceVersion === 0 || gap > 100) {
      return {
        type:    "full-state",
        content: doc.content,
        version: doc.version,
      };
    }

    const missedOps = await documentRepository.getOperationsSince(
      docId,
      sinceVersion
    );

    return {
      type:      "catch-up",
      missedOps: missedOps.map(o => ({
        op:      o.op as Operation,
        version: o.version,
        userId:  o.user_id,
      })),
      version: doc.version,
    };
  },
};