import { db } from "../../config/db";
import type { PoolClient } from "pg";

export type Document = {
  id:         string;
  title:      string;
  content:    string;
  version:    number;
  owner_id:   string;
  created_at: Date;
  updated_at: Date;
};

export type DocumentSummary = Omit<Document, "content">;

export type Operation = {
  id:         number;
  doc_id:     string;
  version:    number;
  op:         { type: "insert" | "delete"; position: number; text?: string; length?: number };
  user_id:    string;
  created_at: Date;
};

type Queryable = Pick<PoolClient, "query">;

export const documentRepository = {

  async create(ownerId: string, title: string): Promise<Document> {
    const { rows } = await db.query<Document>(
      `INSERT INTO documents (title, content, version, owner_id)
       VALUES ($1, '', 0, $2)
       RETURNING *`,
      [title, ownerId]
    );
    return rows[0];
  },

  async findById(docId: string): Promise<Document | null> {
    const { rows } = await db.query<Document>(
      "SELECT * FROM documents WHERE id = $1",
      [docId]
    );
    return rows[0] ?? null;
  },

  async findByOwner(ownerId: string): Promise<DocumentSummary[]> {
    const { rows } = await db.query<DocumentSummary>(
      `SELECT id, title, version, owner_id, created_at, updated_at
       FROM documents
       WHERE owner_id = $1
       ORDER BY updated_at DESC`,
      [ownerId]
    );
    return rows;
  },

  async updateTitle(docId: string, title: string): Promise<Document | null> {
    const { rows } = await db.query<Document>(
      `UPDATE documents
       SET title = $1
       WHERE id = $2
       RETURNING *`,
      [title, docId]
    );
    return rows[0] ?? null;
  },

  async delete(docId: string): Promise<boolean> {
    const { rowCount } = await db.query(
      "DELETE FROM documents WHERE id = $1",
      [docId]
    );
    return (rowCount ?? 0) > 0;
  },

  async findByIdForUpdate(
    docId: string,
    trx: Queryable
  ): Promise<Document | null> {
    const { rows } = await trx.query<Document>(
      "SELECT * FROM documents WHERE id = $1 FOR UPDATE",
      [docId]
    );
    return rows[0] ?? null;
  },

  async updateContentAndVersion(
    docId:      string,
    content:    string,
    newVersion: number,
    trx:        Queryable
  ): Promise<void> {
    await trx.query(
      `UPDATE documents
       SET content = $1, version = $2
       WHERE id = $3`,
      [content, newVersion, docId]
    );
  },

  async checkPermission(
    userId: string,
    docId:  string
  ): Promise<"owner" | "editor" | "viewer" | null> {
    const { rows: ownerRows } = await db.query(
      "SELECT id FROM documents WHERE id = $1 AND owner_id = $2",
      [docId, userId]
    );
    if (ownerRows.length > 0) return "owner";

    const { rows: permRows } = await db.query(
      `SELECT role FROM document_permissions
       WHERE doc_id = $1 AND user_id = $2`,
      [docId, userId]
    );
    return (permRows[0]?.role as "editor" | "viewer") ?? null;
  },

  async grantPermission(
    docId:  string,
    userId: string,
    role:   "editor" | "viewer"
  ): Promise<void> {
    await db.query(
      `INSERT INTO document_permissions (doc_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (doc_id, user_id) DO UPDATE SET role = $3`,
      [docId, userId, role]
    );
  },

  async revokePermission(docId: string, userId: string): Promise<void> {
    await db.query(
      "DELETE FROM document_permissions WHERE doc_id = $1 AND user_id = $2",
      [docId, userId]
    );
  },

  async insertOperation(
    docId:   string,
    version: number,
    op:      Operation["op"],
    userId:  string,
    trx:     Queryable
  ): Promise<void> {
    await trx.query(
      `INSERT INTO operations (doc_id, version, op, user_id)
       VALUES ($1, $2, $3, $4)`,
      [docId, version, JSON.stringify(op), userId]
    );
  },

  async getOperationsSince(
    docId:       string,
    sinceVersion: number
  ): Promise<Operation[]> {
    const { rows } = await db.query<Operation>(
      `SELECT * FROM operations
       WHERE doc_id = $1 AND version > $2
       ORDER BY version ASC`,
      [docId, sinceVersion]
    );
    return rows;
  },

  async getOperationHistory(
    docId:  string,
    limit:  number = 50,
    offset: number = 0
  ): Promise<Operation[]> {
    const { rows } = await db.query<Operation>(
      `SELECT o.*, u.name as user_name
       FROM operations o
       JOIN users u ON u.id = o.user_id
       WHERE o.doc_id = $1
       ORDER BY o.version DESC
       LIMIT $2 OFFSET $3`,
      [docId, limit, offset]
    );
    return rows;
  },
};