import { Request, Response, NextFunction } from "express";
import { Socket } from "socket.io";
import { authService } from "./auth.service";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id:    string;
        name:  string;
        email: string;
      };
    }
  }
}

declare module "socket.io" {
  interface SocketData {
    user: {
      id:    string;
      name:  string;
      email: string;
    };
  }
}

export async function authMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {

  const token = socket.handshake.auth?.token as string | undefined;

  if (!token) {
    return next(new Error("Authentication required"));
  }

  const result = authService.verifyAccessToken(token);

  if (!result) {
    return next(new Error("Invalid or expired token"));
  }

  const user = await authService.getUserById(result.userId);

  if (!user) {
    return next(new Error("User not found"));
  }

  socket.data.user = user;

  next();
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }

  const token = authHeader.slice(7); 

  const result = authService.verifyAccessToken(token);

  if (!result) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const user = await authService.getUserById(result.userId);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  req.user = user;

  next();
}

// ── Optional auth ─────────────────────────────────────────────────────────────
// For endpoints that work for both guests and logged-in users.
// Sets req.user if a valid token is present, but never rejects.

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const result = authService.verifyAccessToken(token);

    if (result) {
      const user = await authService.getUserById(result.userId);
      if (user) req.user = user;
    }
  }

  next(); 
}