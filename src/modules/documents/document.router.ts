import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware";
import { documentService } from "./document.service";

export const documentRouter = Router();

documentRouter.use(requireAuth);

const createSchema = z.object({
  title: z.string().min(1).max(200),
});

const updateTitleSchema = z.object({
  title: z.string().min(1).max(200),
});

const shareSchema = z.object({
  email: z.string().email(),
  role:  z.enum(["editor", "viewer"]),
});

const historySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function sendResult<T>(
  res:    Response,
  result: { ok: true; data: T } | { ok: false; error: string; status: number },
  successStatus = 200
) {
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  if (result.data === undefined) {
    return res.status(204).send();
  }
  return res.status(successStatus).json(result.data);
}

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

documentRouter.get("/", async (req: Request, res: Response) => {
  const result = await documentService.listByOwner(req.user!.id);
  return sendResult(res, result);
});

documentRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error:   "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await documentService.create(req.user!.id, parsed.data.title);
  return sendResult(res, result, 201);
});

documentRouter.get("/:id", async (req: Request, res: Response) => {
  const documentId = normalizeParam(req.params.id);
  if (!documentId) {
    return res.status(400).json({ error: "Invalid document id" });
  }

  const result = await documentService.getById(documentId, req.user!.id);
  return sendResult(res, result);
});

documentRouter.patch("/:id", async (req: Request, res: Response) => {
  const documentId = normalizeParam(req.params.id);
  if (!documentId) {
    return res.status(400).json({ error: "Invalid document id" });
  }

  const parsed = updateTitleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error:   "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await documentService.updateTitle(
    documentId,
    req.user!.id,
    parsed.data.title
  );
  return sendResult(res, result);
});

documentRouter.delete("/:id", async (req: Request, res: Response) => {
  const documentId = normalizeParam(req.params.id);
  if (!documentId) {
    return res.status(400).json({ error: "Invalid document id" });
  }

  const result = await documentService.delete(documentId, req.user!.id);
  return sendResult(res, result);
});

documentRouter.post("/:id/share", async (req: Request, res: Response) => {
  const documentId = normalizeParam(req.params.id);
  if (!documentId) {
    return res.status(400).json({ error: "Invalid document id" });
  }

  const parsed = shareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error:   "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await documentService.share(
    documentId,
    req.user!.id,
    parsed.data.email,
    parsed.data.role
  );
  return sendResult(res, result);
});

documentRouter.get("/:id/history", async (req: Request, res: Response) => {
  const documentId = normalizeParam(req.params.id);
  if (!documentId) {
    return res.status(400).json({ error: "Invalid document id" });
  }

  const parsed = historySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }

  const result = await documentService.getHistory(
    documentId,
    req.user!.id,
    parsed.data.limit,
    parsed.data.offset
  );
  return sendResult(res, result);
});