import express from "express";
import logger from "morgan";
import { Server } from "socket.io";
import { createServer } from "node:http";
import dotenv from "dotenv";
import { createClient } from "@libsql/client";

dotenv.config();

const port = process.env.PORT || 3000;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
});
const db = createClient({
  url: "libsql://grateful-scrambler-carloswariasa.turso.io",
  authToken: process.env.DB_TOKEN,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL
  )`);

io.on("connection", async (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });

  socket.on("chat message", async (msg) => {
    let result;
    try {
      result = await db.execute({
        sql: `INSERT INTO messages (message) VALUES (:content)`,
        args: { content: msg },
      });
    } catch (error) {
      console.error("Error inserting message:", error);
      return;
    }
    io.emit("chat message", msg, result.lastInsertRowid.toString());
  });

  if (!socket.recovered) {
    try {
      const messages = await db.execute({
        sql: "SELECT id, message FROM messages WHERE id > ?",
        args: [socket.handshake.auth.serverOffset ?? 0],
      });

      messages.rows.forEach((message) => {
        socket.emit("chat message", message.message, message.id.toString());
      });
    } catch (error) {
      console.error("Error fetching chat history:", error);
      return;
    }
  }
});

app.use(express.static("public"));

app.use(logger("dev"));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/client/index.html");
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
