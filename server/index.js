import express from "express";
import logger from "morgan";
import { Server } from "socket.io";
import { createServer } from "node:http";
import dotenv from "dotenv";
import { createClient } from "@libsql/client";
import { Semaphore } from "async-mutex";

dotenv.config();

const port = process.env.PORT || 3000;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
});

// Base de datos
const db = createClient({
  url: "libsql://grateful-scrambler-carloswariasa.turso.io",
  authToken: process.env.DB_TOKEN,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL
  )`);

const semaforoMensajes = new Semaphore(1);

// Eventos WebSocket
io.on("connection", async (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });

  socket.on("chat message", async (msg) => {
    const [value, release] = await semaforoMensajes.acquire(); // Adquirir el semáforo
    try {
      let result = await db.execute({
        sql: `INSERT INTO messages (message) VALUES (:content)`,
        args: { content: msg },
      });
      io.emit("chat message", msg, result.lastInsertRowid.toString());
    } catch (error) {
      console.error("Error inserting message:", error);
      return;
    } finally {
      release(); // Liberar el semáforo
    }
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

// Configuración Express
app.use(express.static("public"));
app.use(logger("dev"));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/client/index.html");
});

// Si no estamos en modo de prueba, iniciamos el servidor
if (process.env.NODE_ENV !== "test") {
  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

// Exportamos `app`, `server` y `io` para pruebas
export { app, server, io };
