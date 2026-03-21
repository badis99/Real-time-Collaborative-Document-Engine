import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../config/db";
import { env } from "../../config/env";

type User = {
  id:         string;
  name:       string;
  email:      string;
  created_at: Date;
};

type AuthSuccess = {
  ok:           true;
  user:         Omit<User, "password">;
  accessToken:  string;
  refreshToken: string;
};

type AuthFailure = {
  ok:    false;
  error: string;
};

type RefreshSuccess = {
  ok:           true;
  accessToken:  string;
  refreshToken: string;
};

function signAccessToken(userId: string): string {
  return jwt.sign(
    { sub: userId },
    env.JWT_SECRET,
    { expiresIn: "15m" }      
  );
}

function signRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: "refresh" },
    env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }         
  );
}

export const authService = {

  async register({
    name, email, password,
  }: { name: string; email: string; password: string }): Promise<AuthSuccess | AuthFailure> {

    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return { ok: false, error: "Email already registered" };
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const { rows } = await db.query<User>(
      `INSERT INTO users (name, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [name, email.toLowerCase(), hashedPassword]
    );

    const user = rows[0];

    const refreshToken = signRefreshToken(user.id);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
    );

    return {
      ok:           true,
      user,
      accessToken:  signAccessToken(user.id),
      refreshToken,
    };
  },

  async login({
    email, password,
  }: { email: string; password: string }): Promise<AuthSuccess | AuthFailure> {

    const { rows } = await db.query<User & { password: string }>(
      "SELECT id, name, email, password, created_at FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      await bcrypt.compare(password, "$2b$12$invalidhashfortimingprotection");
      return { ok: false, error: "Invalid email or password" };
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return { ok: false, error: "Invalid email or password" };
    }

    const refreshToken = signRefreshToken(user.id);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken]
    );

    const { password: _, ...userWithoutPassword } = user;

    return {
      ok:           true,
      user:         userWithoutPassword,
      accessToken:  signAccessToken(user.id),
      refreshToken,
    };
  },

  async refresh(token: string): Promise<RefreshSuccess | AuthFailure> {
    let payload: { sub: string; type: string };
    try {
      payload = jwt.verify(token, env.REFRESH_TOKEN_SECRET) as typeof payload;
    } catch {
      return { ok: false, error: "Invalid or expired refresh token" };
    }

    if (payload.type !== "refresh") {
      return { ok: false, error: "Invalid token type" };
    }

    const { rows } = await db.query(
      "SELECT id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()",
      [token]
    );
    if (rows.length === 0) {
      return { ok: false, error: "Refresh token has been revoked" };
    }

    await db.query("DELETE FROM refresh_tokens WHERE token = $1", [token]);

    const newRefreshToken = signRefreshToken(payload.sub);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [payload.sub, newRefreshToken]
    );

    return {
      ok:           true,
      accessToken:  signAccessToken(payload.sub),
      refreshToken: newRefreshToken,
    };
  },

  async logout(token: string): Promise<void> {
    await db.query("DELETE FROM refresh_tokens WHERE token = $1", [token]);
  },

  verifyAccessToken(token: string): { userId: string } | null {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
      return { userId: payload.sub };
    } catch {
      return null;
    }
  },

    async getUserById(id: string): Promise<{ id: string; name: string; email: string } | null> {
        const { rows } = await db.query(
            "SELECT id, name, email FROM users WHERE id = $1",
            [id]
        );
    
        return rows[0] ?? null;
    },

};