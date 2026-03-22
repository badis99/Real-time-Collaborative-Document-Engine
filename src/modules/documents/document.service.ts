import { documentRepository, Document, DocumentSummary } from "./document.repository";

type ServiceResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string; status: 400 | 403 | 404 | 409 };


export const documentService = {

  async create(
    ownerId: string,
    title:   string
  ): Promise<ServiceResult<Document>> {

    const trimmed = title.trim();
    if (!trimmed) {
      return { ok: false, error: "Title cannot be empty", status: 400 };
    }

    const doc = await documentRepository.create(ownerId, trimmed);
    return { ok: true, data: doc };
  },

  async getById(
    docId:     string,
    requesterId: string
  ): Promise<ServiceResult<Document>> {

    const doc = await documentRepository.findById(docId);
    if (!doc) {
      return { ok: false, error: "Document not found", status: 404 };
    }

    const role = await documentRepository.checkPermission(requesterId, docId);
    if (!role) {
      return { ok: false, error: "Access denied", status: 403 };
    }

    return { ok: true, data: doc };
  },

  async listByOwner(ownerId: string): Promise<ServiceResult<DocumentSummary[]>> {
    const docs = await documentRepository.findByOwner(ownerId);
    return { ok: true, data: docs };
  },

  async updateTitle(
    docId:       string,
    requesterId: string,
    newTitle:    string
  ): Promise<ServiceResult<Document>> {

    const trimmed = newTitle.trim();
    if (!trimmed) {
      return { ok: false, error: "Title cannot be empty", status: 400 };
    }

    const role = await documentRepository.checkPermission(requesterId, docId);
    if (!role || role === "viewer") {
      return { ok: false, error: "Access denied", status: 403 };
    }

    const updated = await documentRepository.updateTitle(docId, trimmed);
    if (!updated) {
      return { ok: false, error: "Document not found", status: 404 };
    }

    return { ok: true, data: updated };
  },

  async delete(
    docId:       string,
    requesterId: string
  ): Promise<ServiceResult<void>> {

    const role = await documentRepository.checkPermission(requesterId, docId);
    if (role !== "owner") {
      return { ok: false, error: "Document not found", status: 404 };
    }

    await documentRepository.delete(docId);
    return { ok: true, data: undefined };
  },

  async share(
    docId:       string,
    ownerId:     string,
    targetEmail: string,
    role:        "editor" | "viewer"
  ): Promise<ServiceResult<void>> {

    const ownerRole = await documentRepository.checkPermission(ownerId, docId);
    if (ownerRole !== "owner") {
      return { ok: false, error: "Only the owner can share documents", status: 403 };
    }

    const { db } = await import("../../config/db");
    const { rows } = await db.query(
      "SELECT id FROM users WHERE lower(email) = lower($1)",
      [targetEmail]
    );
    if (rows.length === 0) {
      return { ok: false, error: "User not found", status: 404 };
    }

    const targetUserId = rows[0].id;

    if (targetUserId === ownerId) {
      return { ok: false, error: "Cannot share with yourself", status: 400 };
    }

    await documentRepository.grantPermission(docId, targetUserId, role);
    return { ok: true, data: undefined };
  },

  async getHistory(
    docId:       string,
    requesterId: string,
    limit:       number = 50,
    offset:      number = 0
  ): Promise<ServiceResult<Awaited<ReturnType<typeof documentRepository.getOperationHistory>>>> {

    const role = await documentRepository.checkPermission(requesterId, docId);
    if (!role) {
      return { ok: false, error: "Access denied", status: 403 };
    }

    const ops = await documentRepository.getOperationHistory(docId, limit, offset);
    return { ok: true, data: ops };
  },

  async checkAccess(
    userId: string,
    docId:  string
  ): Promise<"owner" | "editor" | "viewer" | null> {
    return documentRepository.checkPermission(userId, docId);
  },
};