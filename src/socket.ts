import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { authMiddleware } from "./modules/auth/auth.middleware";
import { registerCollaborationHandlers } from "./modules/collaboration/collaboration.handler";
import { env } from "./config/env";

export function initSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.NODE_ENV === "development" ? "*" : "https://yourdomain.com" },
    pingInterval: 10_000,
    pingTimeout:  5_000,
  });

  const pubClient = createClient({ url: env.REDIS_URL });
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log("Socket.IO Redis adapter connected");
  });

  io.use(authMiddleware);

  io.on("connection", (socket) => {
    console.log(`${socket.data.user.name} connected — ${socket.id}`);
    registerCollaborationHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      console.log(`${socket.data.user.name} disconnected — ${reason}`);
    });
  });

  return io;
}