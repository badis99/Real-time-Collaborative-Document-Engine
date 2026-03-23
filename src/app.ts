import express from "express";
import cors from "cors";
import { authRouter } from "./modules/auth/auth.router";
import { documentRouter } from "./modules/documents/document.router";

export const app = express();

app.use(cors());

app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth",      authRouter);
app.use("/api/documents", documentRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});