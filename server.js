const http = require("http");
const next = require("next");
const { WebSocketServer, WebSocket } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rooms = new Map();

function getRoomClients(slug) {
  const room = rooms.get(slug);
  if (!room) {
    return [];
  }

  return Array.from(room.clients.values()).map((client) => ({
    id: client.id,
    joinedAt: client.joinedAt,
    displayName: client.displayName,
  }));
}

function broadcastRoomState(slug) {
  const payload = JSON.stringify({
    type: "room-state",
    slug,
    clients: getRoomClients(slug),
    gameState: rooms.get(slug)?.gameState ?? null,
    roomStatus: rooms.get(slug)?.roomStatus ?? "waiting",
  });

  const room = rooms.get(slug);
  if (!room) {
    return;
  }

  room.clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  });
}

function broadcastGameUpdate(slug, payload) {
  const room = rooms.get(slug);
  if (!room) {
    return;
  }

  const message = JSON.stringify(payload);
  room.clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    handle(req, res, req.url);
  });

  const wss = new WebSocketServer({
    server,
    path: "/ws",
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const slug = url.searchParams.get("slug") || url.searchParams.get("room");

    if (!slug) {
      ws.close();
      return;
    }

    if (!rooms.has(slug)) {
      rooms.set(slug, {
        clients: new Map(),
        roomStatus: "waiting",
        gameState: {
          round: 0,
          currentMatch: 0,
          currentRoundItems: [],
          votes: {},
          pendingVoteCount: 0,
        },
      });
    }

    const room = rooms.get(slug);
    const client = {
      id: `${slug}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      joinedAt: Date.now(),
      ws,
      displayName: "Guest",
    };

    if (room.roomStatus === "started" && !room.clients.has(ws)) {
      ws.send(
        JSON.stringify({
          type: "room-locked",
          message: "This game has already started. You can no longer join.",
        }),
      );
      ws.close();
      return;
    }

    room.clients.set(ws, client);
    broadcastRoomState(slug);

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data?.type === "join") {
          room.clients.set(ws, {
            ...room.clients.get(ws),
            displayName: data.displayName || "Guest",
          });
          broadcastRoomState(slug);
        }

        if (data?.type === "start-game") {
          room.roomStatus = "started";
          room.gameState.currentRoundItems = data.currentRoundItems ?? [];
          broadcastGameUpdate(slug, {
            type: "game-started",
            roomStatus: room.roomStatus,
            gameState: room.gameState,
          });
        }

        if (data?.type === "vote") {
          const voteKey = `${data.round}:${data.match}`;
          const existingVotes = room.gameState.votes ?? {};
          const nextVotes = {
            ...existingVotes,
            [voteKey]: data.choice,
          };

          room.gameState.votes = nextVotes;
          room.gameState.pendingVoteCount = Object.keys(nextVotes).length;

          const shouldAdvance = Object.keys(nextVotes).length >= 2;

          if (shouldAdvance) {
            room.gameState.currentMatch =
              (room.gameState.currentMatch ?? 0) + 1;
            room.gameState.pendingVoteCount = 0;
            room.gameState.votes = {};
          }

          broadcastGameUpdate(slug, {
            type: "vote-update",
            vote: data,
            gameState: room.gameState,
          });
        }

        if (data?.type === "sync-state") {
          room.gameState = {
            ...room.gameState,
            ...data.gameState,
          };
          broadcastGameUpdate(slug, {
            type: "game-sync",
            gameState: room.gameState,
          });
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
      const currentRoom = rooms.get(slug);

      if (!currentRoom) {
        return;
      }

      currentRoom.clients.delete(ws);

      if (currentRoom.clients.size === 0) {
        rooms.delete(slug);
      } else {
        broadcastRoomState(slug);
      }
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
