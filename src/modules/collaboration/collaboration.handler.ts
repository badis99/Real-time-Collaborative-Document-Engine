import { Server, Socket } from "socket.io";
import { documentService }      from "../documents/document.service";
import { collaborationService } from "./collaboration.service";
import { presenceService }      from "./presence.service";
import type { CrdtWireOperation } from "../crdt/types";

type JoinDocPayload = {
  docId: string;
};

type OperationPayload = {
  docId: string;
  op:    CrdtWireOperation;
};

type CursorPayload = {
  docId:    string;
  position: number;
};

export function registerCollaborationHandlers(
  io:     Server,
  socket: Socket
): void {

  const user = socket.data.user; 

  socket.on("join-doc", async (
    { docId }: JoinDocPayload,
    ack: Function
  ) => {
    const role = await documentService.checkAccess(user.id, docId);

    if (!role) {
      return ack({ error: "Document not found or access denied" });
    }

    socket.join(docId);

    const payload = await collaborationService.getDocumentState(docId);

    ack({ ok: true, role, ...payload });

    await presenceService.addUser(docId, {
      userId:   user.id,
      name:     user.name,
      socketId: socket.id,
    });

    const existingUsers = await presenceService.getUsers(docId);
    const cursors       = await presenceService.getCursors(
      docId,
      existingUsers.map(u => u.userId).filter(id => id !== user.id)
    );

    socket.emit("presence-state", {
      users:   existingUsers.filter(u => u.socketId !== socket.id),
      cursors,
    });

    socket.to(docId).emit("user-joined", {
      userId: user.id,
      name:   user.name,
    });
  });

  socket.on("operation", async (
    { docId, op }: OperationPayload,
    ack: Function
  ) => {
    const role = await documentService.checkAccess(user.id, docId);

    if (!role || role === "viewer") {
      return ack({ ok: false, error: "Write access required" });
    }

    const result = await collaborationService.applyOperation({
      docId,
      op,
      userId: user.id,
    });

    if (!result.ok) {
      return ack({ ok: false, error: result.error });
    }

    ack({ ok: true, newVersion: result.newVersion });

    socket.to(docId).emit("op-broadcast", {
      op:      result.appliedOp,
      version: result.newVersion,
      userId:  user.id,
    });
  });

  socket.on("cursor-move", async ({ docId, position }: CursorPayload) => {
    await presenceService.updateCursor(docId, user.id, user.name, position);

    socket.to(docId).emit("cursor-update", {
      userId:   user.id,
      name:     user.name,
      position,
    });
  });


  socket.on("leave-doc", async ({ docId }: { docId: string }) => {
    socket.leave(docId);
    await presenceService.removeUser(docId, socket.id);

    socket.to(docId).emit("user-left", { userId: user.id });
  });


  socket.on("disconnecting", async () => {
    const rooms = [...socket.rooms].filter(room => room !== socket.id);

    await Promise.all(
      rooms.map(async docId => {
        await presenceService.removeUser(docId, socket.id);
        socket.to(docId).emit("user-left", { userId: user.id });
      })
    );
  });
}