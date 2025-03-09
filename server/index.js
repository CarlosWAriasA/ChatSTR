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

// Inicialización de la base de datos con manejo de errores
let db;
try {
  db = createClient({
    url: "libsql://grateful-scrambler-carloswariasa.turso.io",
    authToken: process.env.DB_TOKEN,
  });

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL
    )`);
} catch (error) {
  console.error("Error al conectar con la base de datos:", error);
  process.exit(1); // Detener la ejecución si la base de datos no se puede inicializar
}

const semaforoMensajes = new Semaphore(1);

// Eventos WebSocket con manejo de excepciones
io.on("connection", async (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });

  socket.on("chat message", async (msg) => {
    const [value, release] = await semaforoMensajes.acquire(); // Adquirir el semáforo
    try {
      if (!msg || typeof msg !== "string" || msg.trim() === "") {
        throw new Error("Mensaje inválido: debe ser un texto no vacío.");
      }

      let result = await db.execute({
        sql: `INSERT INTO messages (message) VALUES (:content)`,
        args: { content: msg },
      });

      io.emit("chat message", msg, result.lastInsertRowid.toString());
    } catch (error) {
      console.error("Error inserting message:", error.message);
      socket.emit("error", "No se pudo enviar el mensaje. Intente nuevamente.");
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
      console.error("Error fetching chat history:", error.message);
      socket.emit("error", "No se pudo cargar el historial de mensajes.");
    }
  }
});

// Configuración Express
app.use(express.static("public"));
app.use(logger("dev"));

app.get("/", (req, res) => {
  try {
    res.sendFile(process.cwd() + "/client/index.html");
  } catch (error) {
    console.error("Error al servir el archivo HTML:", error.message);
    res.status(500).send("Error interno del servidor.");
  }
});

// Manejo de errores globales en Express
app.use((err, req, res, next) => {
  console.error("Error en la aplicación:", err.message);
  res.status(500).send("Error interno del servidor.");
});

// Si no estamos en modo de prueba, iniciamos el servidor con manejo de errores
if (process.env.NODE_ENV !== "test") {
  server
    .listen(port, () => {
      console.log(`Server listening on port ${port}`);
    })
    .on("error", (error) => {
      console.error("Error al iniciar el servidor:", error.message);
      process.exit(1);
    });
}

// Exportamos `app`, `server` y `io` para pruebas
export { app, server, io };
