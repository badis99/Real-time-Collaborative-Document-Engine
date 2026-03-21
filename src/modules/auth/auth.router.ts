import { Router, Request, Response } from "express";
import { z } from "zod";
import { authService } from "./auth.service";

export const authRouter = Router();

const registerSchema = z.object({
  name:     z.string().min(2).max(50),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error:   "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { name, email, password } = parsed.data;

  const result = await authService.register({ name, email, password });

  if (!result.ok) {
    return res.status(409).json({ error: result.error });
  }

  return res.status(201).json({
    user:         result.user,
    accessToken:  result.accessToken,
    refreshToken: result.refreshToken,
  });
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error:   "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password } = parsed.data;

  const result = await authService.login({ email, password });

  if (!result.ok) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  return res.status(200).json({
    user:         result.user,
    accessToken:  result.accessToken,
    refreshToken: result.refreshToken,
  });
});

authRouter.post("/refresh", async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken || typeof refreshToken !== "string") {
    return res.status(400).json({ error: "refreshToken required" });
  }

  const result = await authService.refresh(refreshToken);

  if (!result.ok) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  return res.status(200).json({
    accessToken:  result.accessToken,
    refreshToken: result.refreshToken,
  });
});

authRouter.post("/logout", async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await authService.logout(refreshToken);
  }

  return res.status(204).send();
});