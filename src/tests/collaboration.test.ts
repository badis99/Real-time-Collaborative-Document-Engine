import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer } from "http";
import { Server } from "socket.io";
import { io as Client, Socket as ClientSocket } from "socket.io-client";
import { app } from "../app";
import { initSocketServer } from "../socket";
import { db } from "../config/db";
import { authService } from "../modules/auth/auth.service";
import { SENTINEL_ID } from "../modules/crdt/document";
import type { CharId, CharNode } from "../modules/crdt/types";

type JoinAck = {
  ok: boolean;
  role?: "owner" | "editor" | "viewer";
  state?: CharNode[];
  version?: number;
  error?: string;
};

type OpAck = {
  ok: boolean;
  newVersion?: number;
  error?: string;
};

let httpServer: ReturnType<typeof createServer>;
let ioServer: Server;
let serverPort: number;

let userA: { id: string; token: string };
let userB: { id: string; token: string };
let docId: string;

beforeAll(async () => {
  httpServer = createServer(app);
  ioServer = initSocketServer(httpServer);

  await new Promise<void>(resolve => {
    httpServer.listen(0, () => resolve());
  });

  serverPort = (httpServer.address() as { port: number }).port;

  const regA = await authService.register({
    name: "Alice",
    email: `alice-${Date.now()}@test.com`,
    password: "password123",
  });
  const regB = await authService.register({
    name: "Bob",
    email: `bob-${Date.now()}@test.com`,
    password: "password123",
  });

  if (!regA.ok || !regB.ok) {
    throw new Error("Test user registration failed");
  }

  userA = { id: regA.user.id, token: regA.accessToken };
  userB = { id: regB.user.id, token: regB.accessToken };

  const { rows } = await db.query(
    `INSERT INTO documents (title, content, version, owner_id)
     VALUES ($1, $2, 0, $3)
     RETURNING id`,
    ["Test Doc", "", userA.id]
  );
  docId = rows[0].id;

  await db.query(
    `INSERT INTO document_permissions (doc_id, user_id, role)
     VALUES ($1, $2, 'editor')`,
    [docId, userB.id]
  );
});

afterAll(async () => {
  ioServer.close();
  httpServer.close();

  await db.query("DELETE FROM documents WHERE id = $1", [docId]);
  await db.query("DELETE FROM users WHERE id = ANY($1)", [[userA.id, userB.id]]);
  await db.end();
});

beforeEach(async () => {
  await resetDocument("");
});

function createClient(token: string): ClientSocket {
  return Client(`http://localhost:${serverPort}`, {
    auth: { token },
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
}

function connect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
    socket.connect();
  });
}

function disconnect(socket: ClientSocket): Promise<void> {
  return new Promise(resolve => {
    socket.on("disconnect", () => resolve());
    socket.disconnect();
  });
}

function joinDoc(socket: ClientSocket, id: string): Promise<JoinAck> {
  return new Promise((resolve, reject) => {
    socket.emit("join-doc", { docId: id }, (res: JoinAck) => {
      if (res.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

function sendOp(socket: ClientSocket, id: string, op: object): Promise<OpAck> {
  return new Promise(resolve => {
    socket.emit("operation", { docId: id, op }, resolve);
  });
}

function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise(resolve => {
    socket.once(event, resolve);
  });
}

function textFromState(state: CharNode[]): string {
  return state.filter(n => !n.deleted && !isRootId(n.id)).map(n => n.value).join("");
}

function isRootId(id: CharId): boolean {
  return id.clientId === SENTINEL_ID.clientId && id.clock === SENTINEL_ID.clock;
}

function visibleNodes(state: CharNode[]): CharNode[] {
  return state.filter(n => !n.deleted && !isRootId(n.id));
}

function insertWire(clientId: string, clock: number, afterId: CharId | null, char: string) {
  return {
    type: "insert" as const,
    id: { clientId, clock },
    afterId,
    char,
  };
}

function deleteWire(id: CharId) {
  return {
    type: "delete" as const,
    id,
  };
}

async function resetDocument(text: string): Promise<void> {
  await db.query("DELETE FROM operations WHERE doc_id = $1", [docId]);

  let afterId: CharId = SENTINEL_ID;
  let version = 0;

  for (let i = 0; i < text.length; i++) {
    version += 1;
    const op = {
      type: "insert",
      id: { clientId: "__seed__", clock: version },
      afterId,
      char: text[i],
    };

    await db.query(
      `INSERT INTO operations (doc_id, version, op, user_id)
       VALUES ($1, $2, $3, $4)`,
      [docId, version, JSON.stringify(op), userA.id]
    );

    afterId = op.id;
  }

  await db.query(
    "UPDATE documents SET content = $1, version = $2 WHERE id = $3",
    [text, version, docId]
  );
}

describe("collaboration — connection and auth", () => {
  it("rejects connection with no token", async () => {
    const socket = Client(`http://localhost:${serverPort}`, {
      auth: {},
      autoConnect: false,
      transports: ["websocket"],
    });

    await expect(connect(socket)).rejects.toThrow();
    socket.disconnect();
  });

  it("rejects connection with an invalid token", async () => {
    const socket = Client(`http://localhost:${serverPort}`, {
      auth: { token: "not.a.real.jwt" },
      autoConnect: false,
      transports: ["websocket"],
    });

    await expect(connect(socket)).rejects.toThrow();
    socket.disconnect();
  });

  it("accepts connection with a valid token", async () => {
    const socket = createClient(userA.token);
    await expect(connect(socket)).resolves.toBeUndefined();
    await disconnect(socket);
  });
});

describe("collaboration — joining a document", () => {
  it("returns CRDT state and version on join", async () => {
    await resetDocument("Hello world");

    const socket = createClient(userA.token);
    await connect(socket);

    const ack = await joinDoc(socket, docId);
    expect(ack.ok).toBe(true);
    expect(ack.version).toBe(11);
    expect(ack.state).toBeDefined();
    expect(textFromState(ack.state ?? [])).toBe("Hello world");

    await disconnect(socket);
  });

  it("rejects join for a document the user cannot access", async () => {
    const { rows } = await db.query(
      `INSERT INTO documents (title, content, version, owner_id)
       VALUES ('Private', '', 0, $1)
       RETURNING id`,
      [userA.id]
    );
    const privateDocId = rows[0].id;

    const socket = createClient(userB.token);
    await connect(socket);

    const res: JoinAck = await new Promise(resolve =>
      socket.emit("join-doc", { docId: privateDocId }, resolve)
    );

    expect(res.error).toBeDefined();

    await disconnect(socket);
    await db.query("DELETE FROM documents WHERE id = $1", [privateDocId]);
  });
});

describe("collaboration — single client operations", () => {
  it("applies insert ops and updates derived content", async () => {
    const socket = createClient(userA.token);
    await connect(socket);

    const join = await joinDoc(socket, docId);
    const state = join.state ?? [];

    const ack1 = await sendOp(socket, docId, insertWire("alice", 1, SENTINEL_ID, "H"));
    expect(ack1.ok).toBe(true);
    expect(ack1.newVersion).toBe(1);

    const hNode = visibleNodes(state.concat((await joinDoc(socket, docId)).state ?? [])).find(n => n.value === "H");
    const afterId = hNode?.id ?? { clientId: "alice", clock: 1 };

    const ack2 = await sendOp(socket, docId, insertWire("alice", 2, afterId, "i"));
    expect(ack2.ok).toBe(true);
    expect(ack2.newVersion).toBe(2);

    const { rows } = await db.query(
      "SELECT content, version FROM documents WHERE id = $1",
      [docId]
    );

    expect(rows[0].content).toBe("Hi");
    expect(rows[0].version).toBe(2);

    await disconnect(socket);
  });

  it("applies delete op by char id", async () => {
    await resetDocument("Hi!");

    const socket = createClient(userA.token);
    await connect(socket);

    const join = await joinDoc(socket, docId);
    const bang = visibleNodes(join.state ?? []).find(n => n.value === "!");
    expect(bang).toBeDefined();

    const ack = await sendOp(socket, docId, deleteWire(bang!.id));
    expect(ack.ok).toBe(true);

    const { rows } = await db.query("SELECT content FROM documents WHERE id = $1", [docId]);
    expect(rows[0].content).toBe("Hi");

    await disconnect(socket);
  });

  it("rejects an operation from a viewer", async () => {
    await db.query(
      "UPDATE document_permissions SET role = 'viewer' WHERE doc_id = $1 AND user_id = $2",
      [docId, userB.id]
    );

    const socket = createClient(userB.token);
    await connect(socket);
    await joinDoc(socket, docId);

    const ack = await sendOp(socket, docId, insertWire("bob", 1, SENTINEL_ID, "X"));
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/write access/i);

    await db.query(
      "UPDATE document_permissions SET role = 'editor' WHERE doc_id = $1 AND user_id = $2",
      [docId, userB.id]
    );

    await disconnect(socket);
  });
});

describe("collaboration — two clients", () => {
  it("same-anchor concurrent inserts converge with deterministic ordering", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await connect(socketB);

    await joinDoc(socketA, docId);
    await joinDoc(socketB, docId);

    const ackA = await sendOp(socketA, docId, insertWire("alice", 1, SENTINEL_ID, "A"));
    const ackB = await sendOp(socketB, docId, insertWire("bob", 1, SENTINEL_ID, "B"));

    expect(ackA.ok).toBe(true);
    expect(ackB.ok).toBe(true);

    const { rows } = await db.query("SELECT content FROM documents WHERE id = $1", [docId]);
    expect(rows[0].content).toBe("BA");

    await disconnect(socketA);
    await disconnect(socketB);
  });

  it("op-broadcast carries the applied CRDT operation payload", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await connect(socketB);

    await joinDoc(socketA, docId);
    await joinDoc(socketB, docId);

    const broadcastToA = waitForEvent<{ op: any; version: number; userId: string }>(
      socketA,
      "op-broadcast"
    );

    const op = insertWire("bob", 1, SENTINEL_ID, "Z");
    const ack = await sendOp(socketB, docId, op);
    expect(ack.ok).toBe(true);

    const broadcast = await broadcastToA;
    expect(broadcast.op).toEqual(op);
    expect(broadcast.userId).toBe(userB.id);
    expect(broadcast.version).toBe(1);

    await disconnect(socketA);
    await disconnect(socketB);
  });
});

describe("collaboration — reconnection and state recovery", () => {
  it("reconnecting client gets latest CRDT state", async () => {
    await resetDocument("Hello");

    const socketA = createClient(userA.token);
    await connect(socketA);
    await joinDoc(socketA, docId);
    await disconnect(socketA);

    const socketB = createClient(userB.token);
    await connect(socketB);
    const joinB = await joinDoc(socketB, docId);
    const nodes = visibleNodes(joinB.state ?? []);
    const last = nodes[nodes.length - 1];

    const ack = await sendOp(socketB, docId, insertWire("bob", 100, last.id, "!"));
    expect(ack.ok).toBe(true);

    await disconnect(socketB);

    const socketA2 = createClient(userA.token);
    await connect(socketA2);
    const joinA2 = await joinDoc(socketA2, docId);

    expect(textFromState(joinA2.state ?? [])).toBe("Hello!");
    expect(joinA2.version).toBe(6);

    await disconnect(socketA2);
  });
});

describe("collaboration — presence", () => {
  it("sends presence-state with existing users when joining", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await joinDoc(socketA, docId);

    const presencePromise = waitForEvent<{ users: any[] }>(socketB, "presence-state");

    await connect(socketB);
    await joinDoc(socketB, docId);

    const presence = await presencePromise;
    expect(presence.users.some((u: any) => u.userId === userA.id)).toBe(true);

    await disconnect(socketA);
    await disconnect(socketB);
  });

  it("notifies room when a user disconnects", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await connect(socketB);
    await joinDoc(socketA, docId);
    await joinDoc(socketB, docId);

    const leftPromise = waitForEvent<{ userId: string }>(socketA, "user-left");

    await disconnect(socketB);

    const left = await leftPromise;
    expect(left.userId).toBe(userB.id);

    await disconnect(socketA);
  });
});
