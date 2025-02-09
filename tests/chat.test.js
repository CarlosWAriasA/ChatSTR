import request from "supertest";
import { io as Client } from "socket.io-client";
import { app, server, io } from "../server/index";

let clientSocket;

beforeAll((done) => {
  server.listen(() => done());
});

afterAll((done) => {
  io.close();
  server.close();
  done();
});

describe("📝 Pruebas de ChatSTR", () => {
  test("✅ Debería responder en la ruta raíz con HTML", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("text/html");
  });

  test("✅ Conexión al servidor WebSocket", (done) => {
    clientSocket = Client(`http://localhost:${server.address().port}`);

    clientSocket.on("connect", () => {
      expect(clientSocket.connected).toBe(true);
      clientSocket.disconnect();
      done();
    });
  });

  test("✅ Enviar y recibir un mensaje en tiempo real", (done) => {
    const testMessage = "Hola, este es un mensaje de prueba";

    clientSocket = Client(`http://localhost:${server.address().port}`);

    clientSocket.on("connect", () => {
      clientSocket.emit("chat message", testMessage);
    });

    io.on("connection", (socket) => {
      socket.on("chat message", (msg) => {
        expect(msg).toBe(testMessage);
        done();
      });
    });
  });
});
