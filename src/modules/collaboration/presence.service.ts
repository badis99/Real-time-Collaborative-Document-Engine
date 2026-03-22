import { createClient } from "redis";
import { env } from "../../config/env";

const redis = createClient({ url: env.REDIS_URL });

redis.connect().catch(err => {
  console.error("Presence Redis connection failed:", err);
  process.exit(1);
});

export type PresenceUser = {
  userId:   string;
  name:     string;
  socketId: string;
};

export type CursorPosition = {
  userId:   string;
  name:     string;
  position: number;
};

const keys = {
  roomUsers: (docId: string) => `doc:${docId}:users`,
  cursor:    (docId: string, userId: string) => `doc:${docId}:cursor:${userId}`,
};

const USER_TTL_SECONDS   = 60;   
const CURSOR_TTL_SECONDS = 30; 

export const presenceService = {

  async addUser(
    docId:    string,
    user:     PresenceUser
  ): Promise<void> {
    await redis.hSet(
      keys.roomUsers(docId),
      user.socketId,
      JSON.stringify(user)
    );
    await redis.expire(keys.roomUsers(docId), USER_TTL_SECONDS);
  },

  async removeUser(docId: string, socketId: string): Promise<void> {
    await redis.hDel(keys.roomUsers(docId), socketId);
  },

  async getUsers(docId: string): Promise<PresenceUser[]> {
    const entries = await redis.hGetAll(keys.roomUsers(docId));
    return Object.values(entries).map(v => JSON.parse(v) as PresenceUser);
  },

  async refreshTTL(docId: string): Promise<void> {
    await redis.expire(keys.roomUsers(docId), USER_TTL_SECONDS);
  },

  async updateCursor(
    docId:    string,
    userId:   string,
    name:     string,
    position: number
  ): Promise<void> {
    const cursor: CursorPosition = { userId, name, position };
    await redis.set(
      keys.cursor(docId, userId),
      JSON.stringify(cursor),
      { EX: CURSOR_TTL_SECONDS }  
    );
  },

  async getCursors(docId: string, userIds: string[]): Promise<CursorPosition[]> {
    if (userIds.length === 0) return [];

    const cursorKeys = userIds.map(id => keys.cursor(docId, id));
    const values     = await redis.mGet(cursorKeys);

    return values
      .filter((v): v is string => v !== null)
      .map(v => JSON.parse(v) as CursorPosition);
  },
};