import { WebSocketServer, WebSocket } from "ws";

const wss = new WebSocketServer({ port: 8080 });
const rooms = new Map<
  string,
  {
    sessionSlug: string | null;
    roomCode: string | null;
    players: Map<string | null, WebSocket>;
    state: Record<string, unknown>;
  }
>();

function getRoomKey(sessionSlug: string | null, roomCode: string | null) {
  return `${sessionSlug ?? "unknown"}:${roomCode ?? "unknown"}`;
}

wss.on("connection", (ws, req) => {
  const params = new URLSearchParams(req.url ? req.url.replace("/?", "") : "");
  const sessionSlug = params.get("sessionSlug");
  const roomCode = params.get("roomCode");
  const userId = params.get("userId");

  const key = getRoomKey(sessionSlug, roomCode);

  if (!rooms.has(key)) {
    rooms.set(key, {
      sessionSlug,
      roomCode,
      players: new Map(),
      state: {},
    });
  }

  const room = rooms.get(key);
  if (!room) {
    ws.close();
    return;
  }

  room.players.set(userId, ws);

  ws.on("message", (msg) => {
    for (const [pid, client] of room.players) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ from: userId, msg }));
      }
    }
  });

  ws.on("close", () => {
    room.players.delete(userId);
    if (room.players.size === 0) rooms.delete(key);
  });
});
