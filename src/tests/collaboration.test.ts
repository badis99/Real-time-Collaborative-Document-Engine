import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer } from "http";
import { Server }       from "socket.io";
import { io as Client, Socket as ClientSocket } from "socket.io-client";
import { app }                from "../app";
import { initSocketServer }   from "../socket";
import { db }                 from "../config/db";
import { authService }        from "../modules/auth/auth.service";

// ── Test server setup ─────────────────────────────────────────────────────────

let httpServer: ReturnType<typeof createServer>;
let ioServer:   Server;
let serverPort: number;

// Two test users and their tokens
let userA: { id: string; token: string };
let userB: { id: string; token: string };

// The document both clients will edit
let docId: string;

beforeAll(async () => {
  // Spin up a real HTTP + Socket.IO server on a random port
  httpServer = createServer(app);
  ioServer   = initSocketServer(httpServer);

  await new Promise<void>(resolve => {
    httpServer.listen(0, () => resolve());   // port 0 = OS picks a free port
  });

  serverPort = (httpServer.address() as { port: number }).port;

  // Create two test users directly via the service (bypasses HTTP)
  const regA = await authService.register({
    name:     "Alice",
    email:    `alice-${Date.now()}@test.com`,
    password: "password123",
  });
  const regB = await authService.register({
    name:     "Bob",
    email:    `bob-${Date.now()}@test.com`,
    password: "password123",
  });

  if (!regA.ok || !regB.ok) throw new Error("Test user registration failed");

  userA = { id: regA.user.id, token: regA.accessToken };
  userB = { id: regB.user.id, token: regB.accessToken };

  // Create a shared document owned by Alice
  const { rows } = await db.query(
    `INSERT INTO documents (title, content, version, owner_id)
     VALUES ($1, $2, 0, $3)
     RETURNING id`,
    ["Test Doc", "Hello world", userA.id]
  );
  docId = rows[0].id;

  // Grant Bob editor access
  await db.query(
    `INSERT INTO document_permissions (doc_id, user_id, role)
     VALUES ($1, $2, 'editor')`,
    [docId, userB.id]
  );
});

afterAll(async () => {
  ioServer.close();
  httpServer.close();

  // Clean up test data
  await db.query("DELETE FROM documents WHERE id = $1", [docId]);
  await db.query("DELETE FROM users WHERE id = ANY($1)", [[userA.id, userB.id]]);
  await db.end();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function createClient(token: string): ClientSocket {
  return Client(`http://localhost:${serverPort}`, {
    auth:                { token },
    autoConnect:         false,
    reconnection:        false,   // no auto-reconnect during tests
    transports:          ["websocket"],
  });
}

// Connect a socket and wait for the connection to be established
function connect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("connect",       resolve);
    socket.on("connect_error", reject);
    socket.connect();
  });
}

// Disconnect and wait for cleanup
function disconnect(socket: ClientSocket): Promise<void> {
  return new Promise(resolve => {
    socket.on("disconnect", () => resolve());
    socket.disconnect();
  });
}

// Join a document room and get the initial state back via ack
function joinDoc(
  socket: ClientSocket,
  id:     string,
  lastVersion = 0
): Promise<{ content: string; version: number; type: string; missedOps?: any[] }> {
  return new Promise((resolve, reject) => {
    socket.emit("join-doc", { docId: id, lastVersion }, (res: any) => {
      if (res.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

// Send an operation and wait for the ack
function sendOp(
  socket:      ClientSocket,
  id:          string,
  op:          object,
  baseVersion: number
): Promise<{ ok: boolean; newVersion: number; error?: string }> {
  return new Promise(resolve => {
    socket.emit("operation", { docId: id, op, baseVersion }, resolve);
  });
}

// Wait for a specific event to arrive on a socket
function waitForEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise(resolve => {
    socket.once(event, resolve);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("collaboration — connection and auth", () => {

  it("rejects connection with no token", async () => {
    const socket = Client(`http://localhost:${serverPort}`, {
      auth:       {},
      autoConnect: false,
      transports: ["websocket"],
    });

    await expect(connect(socket)).rejects.toThrow();
    socket.disconnect();
  });

  it("rejects connection with an invalid token", async () => {
    const socket = Client(`http://localhost:${serverPort}`, {
      auth:       { token: "not.a.real.jwt" },
      autoConnect: false,
      transports:  ["websocket"],
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

  it("sends full document state on first join", async () => {
    const socket = createClient(userA.token);
    await connect(socket);

    const state = await joinDoc(socket, docId, 0);

    expect(state.type).toBe("full-state");
    expect(state.content).toBe("Hello world");
    expect(state.version).toBe(0);

    await disconnect(socket);
  });

  it("rejects join for a document the user cannot access", async () => {
    // Create a doc Alice does NOT share with Bob
    const { rows } = await db.query(
      `INSERT INTO documents (title, content, version, owner_id)
       VALUES ('Private', 'secret', 0, $1)
       RETURNING id`,
      [userA.id]
    );
    const privateDocId = rows[0].id;

    const socket = createClient(userB.token);
    await connect(socket);

    const res: any = await new Promise(resolve =>
      socket.emit("join-doc", { docId: privateDocId, lastVersion: 0 }, resolve)
    );

    expect(res.error).toBeDefined();

    await disconnect(socket);
    await db.query("DELETE FROM documents WHERE id = $1", [privateDocId]);
  });

  it("notifies existing users when someone joins", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await joinDoc(socketA, docId);

    // Listen for the user-joined event before Bob connects
    const joinedPromise = waitForEvent<{ userId: string; name: string }>(
      socketA,
      "user-joined"
    );

    await connect(socketB);
    await joinDoc(socketB, docId);

    const joined = await joinedPromise;
    expect(joined.userId).toBe(userB.id);
    expect(joined.name).toBe("Bob");

    await disconnect(socketA);
    await disconnect(socketB);
  });
});

describe("collaboration — single client operations", () => {

  it("applies an insert operation and returns the new version", async () => {
    // Reset doc to a known state
    await db.query(
      "UPDATE documents SET content = $1, version = 0 WHERE id = $2",
      ["Hello world", docId]
    );
    await db.query("DELETE FROM operations WHERE doc_id = $1", [docId]);

    const socket = createClient(userA.token);
    await connect(socket);
    await joinDoc(socket, docId, 0);

    const ack = await sendOp(
      socket,
      docId,
      { type: "insert", position: 5, text: "!" },
      0   // baseVersion
    );

    expect(ack.ok).toBe(true);
    expect(ack.newVersion).toBe(1);

    // Verify the DB was updated
    const { rows } = await db.query(
      "SELECT content, version FROM documents WHERE id = $1",
      [docId]
    );
    expect(rows[0].content).toBe("Hello! world");
    expect(rows[0].version).toBe(1);

    await disconnect(socket);
  });

  it("applies a delete operation correctly", async () => {
    await db.query(
      "UPDATE documents SET content = $1, version = 0 WHERE id = $2",
      ["Hello world", docId]
    );
    await db.query("DELETE FROM operations WHERE doc_id = $1", [docId]);

    const socket = createClient(userA.token);
    await connect(socket);
    await joinDoc(socket, docId, 0);

    const ack = await sendOp(
      socket,
      docId,
      { type: "delete", position: 5, length: 6 },
      0
    );

    expect(ack.ok).toBe(true);

    const { rows } = await db.query(
      "SELECT content FROM documents WHERE id = $1",
      [docId]
    );
    expect(rows[0].content).toBe("Hello");

    await disconnect(socket);
  });

  it("rejects an operation from a viewer", async () => {
    // Downgrade Bob to viewer
    await db.query(
      "UPDATE document_permissions SET role = 'viewer' WHERE doc_id = $1 AND user_id = $2",
      [docId, userB.id]
    );

    const socket = createClient(userB.token);
    await connect(socket);
    await joinDoc(socket, docId, 0);

    const ack: any = await sendOp(
      socket,
      docId,
      { type: "insert", position: 0, text: "X" },
      0
    );

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/write access/i);

    // Restore Bob to editor for subsequent tests
    await db.query(
      "UPDATE document_permissions SET role = 'editor' WHERE doc_id = $1 AND user_id = $2",
      [docId, userB.id]
    );

    await disconnect(socket);
  });
});

describe("collaboration — two clients, concurrent edits (the core test)", () => {

  beforeEach(async () => {
    // Reset to a clean document state before each concurrent test
    await db.query(
      "UPDATE documents SET content = $1, version = 0 WHERE id = $2",
      ["Hello world", docId]
    );
    await db.query("DELETE FROM operations WHERE doc_id = $1", [docId]);
  });

  it("two inserts at different positions — both clients converge", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await connect(socketB);

    await joinDoc(socketA, docId, 0);
    await joinDoc(socketB, docId, 0);

    // Both clients have doc "Hello world" at version 0.
    // Alice inserts "!" at position 5 — sends first.
    // Bob inserts " beautiful" at position 6 — sends second.
    // Server applies Alice's op first (version 1), then transforms Bob's.

    // Listen for the broadcast Alice will receive when Bob's op lands
    const broadcastToA = waitForEvent<{ op: any; version: number }>(socketA, "op-broadcast");

    // Alice sends her op — gets acked at version 1
    const ackA = await sendOp(
      socketA, docId,
      { type: "insert", position: 5, text: "!" },
      0
    );
    expect(ackA.ok).toBe(true);
    expect(ackA.newVersion).toBe(1);

    // Bob sends his op based on version 0 (he hasn't seen Alice's op yet)
    const ackB = await sendOp(
      socketB, docId,
      { type: "insert", position: 6, text: "beautiful " },
      0
    );
    expect(ackB.ok).toBe(true);
    expect(ackB.newVersion).toBe(2);

    // Wait for Alice to receive Bob's broadcasted (transformed) op
    const broadcast = await broadcastToA;
    expect(broadcast.version).toBe(2);

    // Verify the server document is correct
    const { rows } = await db.query(
      "SELECT content FROM documents WHERE id = $1",
      [docId]
    );
    // Alice's op: "Hello! world"
    // Bob's op (transformed): insert at position 7 (shifted right by 1 for Alice's "!")
    // Final: "Hello! beautiful world"
    expect(rows[0].content).toBe("Hello! beautiful world");

    // Alice's local state: she applied her own op, then applies the broadcast
    // Bob's local state:   he applied his own op (now version 2 via ack)
    // Both should see the same final document if they apply ops correctly

    await disconnect(socketA);
    await disconnect(socketB);
  });

  it("two deletes on non-overlapping ranges — both apply correctly", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await connect(socketB);
    await joinDoc(socketA, docId, 0);
    await joinDoc(socketB, docId, 0);

    // doc = "Hello world"
    // Alice deletes "Hello" (position 0, length 5)
    // Bob   deletes "world" (position 6, length 5)

    const broadcastToA = waitForEvent<any>(socketA, "op-broadcast");

    const ackA = await sendOp(socketA, docId, { type: "delete", position: 0, length: 5 }, 0);
    expect(ackA.ok).toBe(true);   // doc is now " world"

    const ackB = await sendOp(socketB, docId, { type: "delete", position: 6, length: 5 }, 0);
    expect(ackB.ok).toBe(true);

    await broadcastToA;

    const { rows } = await db.query(
      "SELECT content FROM documents WHERE id = $1",
      [docId]
    );
    // After Alice: " world"
    // Bob's delete(6,5) transforms against Alice's delete(0,5) → delete(1,5)
    // Final: " " → trimmed effectively to just the space
    expect(rows[0].content).toBe(" ");

    await disconnect(socketA);
    await disconnect(socketB);
  });

  it("op-broadcast carries the TRANSFORMED op, not the original", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await connect(socketB);
    await joinDoc(socketA, docId, 0);
    await joinDoc(socketB, docId, 0);

    // doc = "Hello world"
    // Alice inserts "AAA" at position 0 — shifts everything right by 3
    // Bob   inserts "BBB" at position 6 — after transform should be at position 9

    const broadcastToA = waitForEvent<{ op: any }>(socketA, "op-broadcast");

    await sendOp(socketA, docId, { type: "insert", position: 0, text: "AAA" }, 0);
    await sendOp(socketB, docId, { type: "insert", position: 6, text: "BBB" }, 0);

    const broadcast = await broadcastToA;

    // The broadcast op must be the TRANSFORMED version
    // Original: insert(6, "BBB") — but Alice inserted 3 chars at 0
    // Transformed: insert(9, "BBB")
    expect(broadcast.op.type).toBe("insert");
    expect(broadcast.op.position).toBe(9);    // shifted right by 3
    expect(broadcast.op.text).toBe("BBB");

    await disconnect(socketA);
    await disconnect(socketB);
  });

  it("sequential ops from one client are ordered correctly", async () => {
    const socket = createClient(userA.token);
    await connect(socket);
    await joinDoc(socket, docId, 0);

    // doc = "Hello world"
    // Send three ops sequentially — each waits for ack before sending next
    const ack1 = await sendOp(socket, docId, { type: "insert", position: 0, text: "1" }, 0);
    const ack2 = await sendOp(socket, docId, { type: "insert", position: 1, text: "2" }, 1);
    const ack3 = await sendOp(socket, docId, { type: "insert", position: 2, text: "3" }, 2);

    expect(ack1.newVersion).toBe(1);
    expect(ack2.newVersion).toBe(2);
    expect(ack3.newVersion).toBe(3);

    const { rows } = await db.query(
      "SELECT content FROM documents WHERE id = $1",
      [docId]
    );
    expect(rows[0].content).toBe("123Hello world");

    await disconnect(socket);
  });
});

describe("collaboration — reconnection and catch-up", () => {

  it("reconnecting client receives missed ops as catch-up payload", async () => {
    await db.query(
      "UPDATE documents SET content = $1, version = 0 WHERE id = $2",
      ["Hello world", docId]
    );
    await db.query("DELETE FROM operations WHERE doc_id = $1", [docId]);

    // Alice connects and joins at version 0
    const socketA = createClient(userA.token);
    await connect(socketA);
    await joinDoc(socketA, docId, 0);

    // Alice disconnects (simulating a network drop)
    await disconnect(socketA);

    // Bob makes two edits while Alice is offline
    const socketB = createClient(userB.token);
    await connect(socketB);
    await joinDoc(socketB, docId, 0);

    await sendOp(socketB, docId, { type: "insert", position: 5, text: "!" }, 0);
    await sendOp(socketB, docId, { type: "insert", position: 0, text: ">>> " }, 1);

    await disconnect(socketB);

    // Alice reconnects — she was at version 0, doc is now at version 2
    const socketA2 = createClient(userA.token);
    await connect(socketA2);

    const catchUp = await joinDoc(socketA2, docId, 0);  // lastVersion = 0

    // Server should send full-state or catch-up depending on gap size
    expect(["full-state", "catch-up"]).toContain(catchUp.type);
    expect(catchUp.version).toBe(2);

    if (catchUp.type === "catch-up") {
      expect(catchUp.missedOps).toHaveLength(2);
      expect(catchUp.missedOps![0].version).toBe(1);
      expect(catchUp.missedOps![1].version).toBe(2);
    }

    if (catchUp.type === "full-state") {
      expect(catchUp.content).toBe(">>> Hello! world");
    }

    await disconnect(socketA2);
  });
});

describe("collaboration — presence", () => {

  it("sends presence-state with existing users when joining", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await joinDoc(socketA, docId);

    // Collect the presence-state event that arrives when Bob joins
    const presencePromise = waitForEvent<{ users: any[] }>(socketB, "presence-state");

    await connect(socketB);
    await joinDoc(socketB, docId);

    const presence = await presencePromise;

    // Bob should see Alice in the presence list
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

  it("broadcasts cursor-update to other clients in the room", async () => {
    const socketA = createClient(userA.token);
    const socketB = createClient(userB.token);

    await connect(socketA);
    await connect(socketB);
    await joinDoc(socketA, docId);
    await joinDoc(socketB, docId);

    const cursorPromise = waitForEvent<{ userId: string; position: number }>(
      socketA,
      "cursor-update"
    );

    socketB.emit("cursor-move", { docId, position: 42 });

    const cursor = await cursorPromise;
    expect(cursor.userId).toBe(userB.id);
    expect(cursor.position).toBe(42);

    await disconnect(socketA);
    await disconnect(socketB);
  });
});