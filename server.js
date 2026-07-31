const http = require("http");
const next = require("next");
const { WebSocketServer, WebSocket } = require("ws");
const { MongoClient } = require("mongodb");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rooms = new Map();
const roomCleanupTimers = new Map();
const roomInitializationPromises = new Map();
const roomPersistenceQueues = new Map();
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS || 300000);

let mongoClientPromise;

function getMongoClientPromise() {
  if (!mongoClientPromise) {
    if (!process.env.MONGODB_URI) {
      return null;
    }

    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    mongoClientPromise = mongoClient.connect();
  }

  return mongoClientPromise;
}

async function withSessionsCollection(callback) {
  const clientPromise = getMongoClientPromise();
  if (!clientPromise) {
    return null;
  }

  const client = await clientPromise;
  const db = client.db("test");
  const sessions = db.collection("sessions");
  return callback(sessions);
}

async function loadPersistedRoom(slug) {
  try {
    const session = await withSessionsCollection((sessions) =>
      sessions.findOne(
        { slug },
        {
          projection: {
            roomStatus: 1,
            gameState: 1,
            participantIds: 1,
            participantLookup: 1,
            gameStateVersion: 1,
            roomSnapshotVersion: 1,
          },
        },
      ),
    );

    return session;
  } catch (error) {
    console.error("Failed to load persisted room state:", error);
    return null;
  }
}

function persistRoomSnapshot(slug, room, options = {}) {
  const gameStateChanged = Boolean(options.gameStateChanged);

  if (gameStateChanged) {
    room.gameStateVersion = (room.gameStateVersion ?? 0) + 1;
  }

  room.roomSnapshotVersion = (room.roomSnapshotVersion ?? 0) + 1;

  const snapshot = {
    roomStatus: room.roomStatus,
    gameState: JSON.parse(JSON.stringify(room.gameState ?? {})),
    participantIds: Array.from(room.participantIds || []),
    gameStateVersion: room.gameStateVersion ?? 0,
    roomSnapshotVersion: room.roomSnapshotVersion,
    roomUpdatedAt: new Date(),
  };

  const previous = roomPersistenceQueues.get(slug) ?? Promise.resolve();
  const next = previous
    .catch(() => {
      // Keep the queue alive even if a previous write failed.
    })
    .then(async () => {
      try {
        await withSessionsCollection((sessions) =>
          sessions.updateOne(
            {
              slug,
              $or: [
                { roomSnapshotVersion: { $exists: false } },
                { roomSnapshotVersion: { $lte: snapshot.roomSnapshotVersion } },
              ],
            },
            {
              $set: snapshot,
            },
          ),
        );
      } catch (error) {
        console.error("Failed to persist room snapshot:", error);
      }
    });

  roomPersistenceQueues.set(slug, next);
  void next.finally(() => {
    if (roomPersistenceQueues.get(slug) === next) {
      roomPersistenceQueues.delete(slug);
    }
  });
}

function scheduleRoomCleanup(slug) {
  if (roomCleanupTimers.has(slug)) {
    return;
  }

  const timer = setTimeout(() => {
    roomCleanupTimers.delete(slug);
    const currentRoom = rooms.get(slug);
    if (!currentRoom || currentRoom.clients.size > 0) {
      return;
    }

    rooms.delete(slug);
  }, ROOM_IDLE_TTL_MS);

  roomCleanupTimers.set(slug, timer);
}

function clearRoomCleanup(slug) {
  const timer = roomCleanupTimers.get(slug);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  roomCleanupTimers.delete(slug);
}

async function getOrCreateRoom(slug) {
  if (rooms.has(slug)) {
    return rooms.get(slug);
  }

  if (roomInitializationPromises.has(slug)) {
    return roomInitializationPromises.get(slug);
  }

  const initializationPromise = (async () => {
    const persisted = await loadPersistedRoom(slug);
    const persistedLookupIds = Object.keys(persisted?.participantLookup ?? {});

    const room = {
      clients: new Map(),
      participantIds: new Set(
        persisted?.participantIds?.length
          ? persisted.participantIds
          : persistedLookupIds,
      ),
      roomStatus: persisted?.roomStatus || "waiting",
      gameStateVersion: Number(persisted?.gameStateVersion ?? 0),
      roomSnapshotVersion: Number(persisted?.roomSnapshotVersion ?? 0),
      gameState: persisted?.gameState || {
        round: 0,
        currentMatch: 0,
        currentRoundItems: [],
        votesByMatch: {},
        pendingVoteCount: 0,
        roundWinners: [],
        winner: null,
      },
    };

    rooms.set(slug, room);
    return room;
  })();

  roomInitializationPromises.set(slug, initializationPromise);

  try {
    return await initializationPromise;
  } finally {
    roomInitializationPromises.delete(slug);
  }
}

function getMatchKey(round, match) {
  return `${round}:${match}`;
}

function resolveWinningChoice(matchVotes, leftIndex, rightIndex) {
  const tally = {
    [leftIndex]: 0,
    [rightIndex]: 0,
  };

  Object.values(matchVotes).forEach((vote) => {
    if (vote?.choice === rightIndex) {
      tally[rightIndex] += 1;
      return;
    }

    tally[leftIndex] += 1;
  });

  if (tally[rightIndex] > tally[leftIndex]) {
    return rightIndex;
  }

  return leftIndex;
}

function getRoomClients(slug) {
  const room = rooms.get(slug);
  if (!room) {
    return [];
  }

  return Array.from(room.clients.values()).map((client) => ({
    id: client.participantId || client.id,
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
    handle(req, res);
  });
  const handleUpgrade = app.getUpgradeHandler();

  const wss = new WebSocketServer({
    noServer: true,
  });

  server.on("upgrade", (req, socket, head) => {
    const hostHeader =
      typeof req.headers.host === "string" && req.headers.host.length > 0
        ? req.headers.host
        : "localhost";

    let pathname = "/";
    try {
      const requestUrl = new URL(req.url || "/", `http://${hostHeader}`);
      pathname = requestUrl.pathname;
    } catch {
      pathname = "/";
    }

    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }

    handleUpgrade(req, socket, head);
  });

  wss.on("connection", async (ws, req) => {
    const hostHeader =
      typeof req.headers.host === "string" && req.headers.host.length > 0
        ? req.headers.host
        : "localhost";

    let url;
    try {
      url = new URL(req.url || "/", `http://${hostHeader}`);
    } catch (error) {
      console.error("WebSocket connection URL parse error:", {
        url: req.url,
        host: req.headers.host,
        error,
      });
      ws.close();
      return;
    }

    const slug = url.searchParams.get("slug") || url.searchParams.get("room");
    const queryParticipantId = url.searchParams.get("participantId") || null;
    const queryDisplayName = url.searchParams.get("displayName") || "Guest";

    if (!slug) {
      ws.close();
      return;
    }

    const room = await getOrCreateRoom(slug);
    clearRoomCleanup(slug);

    if (
      room.roomStatus === "started" &&
      queryParticipantId &&
      !room.participantIds.has(queryParticipantId)
    ) {
      ws.send(
        JSON.stringify({
          type: "room-locked",
          message: "This game has already started. You can no longer join.",
        }),
      );
      ws.close();
      return;
    }

    const client = {
      id: `${slug}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      participantId: queryParticipantId,
      joinedAt: Date.now(),
      ws,
      displayName: queryDisplayName,
    };

    if (queryParticipantId) {
      room.participantIds.add(queryParticipantId);
    }

    room.clients.set(ws, client);
    persistRoomSnapshot(slug, room);
    broadcastRoomState(slug);

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data?.type === "join") {
          const incomingParticipantId =
            typeof data.participantId === "string" &&
            data.participantId.length > 0
              ? data.participantId
              : room.clients.get(ws)?.id;
          const isKnownParticipant = room.participantIds.has(
            incomingParticipantId,
          );

          if (room.roomStatus === "started" && !isKnownParticipant) {
            ws.send(
              JSON.stringify({
                type: "room-locked",
                message:
                  "This game has already started. You can no longer join.",
              }),
            );
            ws.close();
            return;
          }

          room.participantIds.add(incomingParticipantId);
          room.clients.set(ws, {
            ...room.clients.get(ws),
            participantId: incomingParticipantId,
            displayName: data.displayName || "Guest",
          });

          ws.send(
            JSON.stringify({
              type: "join-ack",
              participantId: incomingParticipantId,
              displayName: data.displayName || "Guest",
            }),
          );

          persistRoomSnapshot(slug, room);
          broadcastRoomState(slug);
        }

        if (data?.type === "start-game") {
          room.participantIds = new Set(
            Array.from(room.clients.values()).map(
              (entry) => entry.participantId || entry.id,
            ),
          );
          room.roomStatus = "started";
          room.gameState = {
            round: 0,
            currentMatch: 0,
            currentRoundItems: data.currentRoundItems ?? [],
            votesByMatch: {},
            pendingVoteCount: 0,
            roundWinners: [],
            winner: null,
          };
          persistRoomSnapshot(slug, room, { gameStateChanged: true });
          broadcastGameUpdate(slug, {
            type: "game-started",
            roomStatus: room.roomStatus,
            gameState: room.gameState,
          });
        }

        if (data?.type === "vote") {
          const playerId =
            typeof data.playerId === "string" && data.playerId.length > 0
              ? data.playerId
              : room.clients.get(ws)?.participantId || room.clients.get(ws)?.id;
          const round =
            typeof data.round === "number"
              ? data.round
              : (room.gameState.round ?? 0);
          const match =
            typeof data.match === "number"
              ? data.match
              : (room.gameState.currentMatch ?? 0);
          const choice = Number(data.choice);

          if (!playerId || Number.isNaN(choice)) {
            return;
          }

          const matchKey = getMatchKey(round, match);
          const existingVotes = room.gameState.votesByMatch ?? {};
          const matchVotes = {
            ...(existingVotes[matchKey] ?? {}),
            [playerId]: {
              choice,
              at: Date.now(),
            },
          };

          room.gameState.votesByMatch = {
            ...existingVotes,
            [matchKey]: matchVotes,
          };

          const currentRoundItems = room.gameState.currentRoundItems ?? [];
          const leftIndex = match * 2;
          const rightIndex = leftIndex + 1;
          const left = currentRoundItems[leftIndex];
          const right = currentRoundItems[rightIndex];

          if (!left) {
            return;
          }

          const activeParticipantCount = room.participantIds.size;
          const requiredVotes = right
            ? Math.max(1, Math.min(2, activeParticipantCount))
            : 1;
          room.gameState.pendingVoteCount = Object.keys(matchVotes).length;
          room.gameState.requiredVoteCount = requiredVotes;

          if (room.gameState.pendingVoteCount >= requiredVotes) {
            const winningChoice = right
              ? resolveWinningChoice(matchVotes, leftIndex, rightIndex)
              : leftIndex;
            const winnerItem =
              right && winningChoice === rightIndex ? right : left;
            const nextRoundWinners = [...(room.gameState.roundWinners ?? [])];
            nextRoundWinners[match] = winnerItem;

            const totalMatches = Math.ceil(currentRoundItems.length / 2);
            const completedMatches = nextRoundWinners.filter(Boolean).length;

            room.gameState.roundWinners = nextRoundWinners;
            room.gameState.pendingVoteCount = 0;

            if (completedMatches >= totalMatches) {
              const nextRoundItems = nextRoundWinners.filter(Boolean);

              if (nextRoundItems.length <= 1) {
                room.gameState = {
                  ...room.gameState,
                  currentRoundItems: nextRoundItems,
                  currentMatch: 0,
                  votesByMatch: {},
                  pendingVoteCount: 0,
                  roundWinners: [],
                  winner: nextRoundItems[0] ?? null,
                };
                room.roomStatus = "completed";
              } else {
                room.gameState = {
                  ...room.gameState,
                  round: (room.gameState.round ?? 0) + 1,
                  currentMatch: 0,
                  currentRoundItems: nextRoundItems,
                  votesByMatch: {},
                  pendingVoteCount: 0,
                  roundWinners: [],
                };
              }
            } else {
              room.gameState.currentMatch =
                (room.gameState.currentMatch ?? 0) + 1;
            }
          }

          broadcastGameUpdate(slug, {
            type: "vote-update",
            roomStatus: room.roomStatus,
            vote: data,
            gameState: room.gameState,
          });
          persistRoomSnapshot(slug, room, { gameStateChanged: true });
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
          persistRoomSnapshot(slug, room, { gameStateChanged: true });
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
        persistRoomSnapshot(slug, currentRoom);
        scheduleRoomCleanup(slug);
      } else {
        broadcastRoomState(slug);
      }
    });
  });

  server.listen(port, hostname, () => {
    console.log(
      `> Ready on http://localhost:${port} (bound to ${hostname}:${port})`,
    );
  });
});
