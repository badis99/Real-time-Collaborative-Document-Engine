import { createServer } from "http";
import { app } from "./app";
import { initSocketServer } from "./socket";
import { env } from "./config/env";

const httpServer = createServer(app);
initSocketServer(httpServer);

const server = httpServer.listen(env.PORT, () => {
  console.log(`Server running on :${env.PORT}`);
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received — shutting down`);
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));