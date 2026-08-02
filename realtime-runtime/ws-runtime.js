const { URL } = require("url");
const { WebSocketServer, WebSocket } = require("ws");
const { MongoClient } = require("mongodb");

const rooms = new Map();
const roomCleanupTimers = new Map();
const roomExpirationTimers = new Map();
const roomInitializationPromises = new Map();
const roomPersistenceQueues = new Map();
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS || 300000);
const DEFAULT_SESSION_TTL_MS = Number(
  process.env.SESSION_TTL_MS || 30 * 60 * 1000,
);
const DEFAULT_MATCH_SIZE = 2;

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
            expiresAt: 1,
            createdAt: 1,
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
    expiresAt: room.expiresAt ?? null,
    createdAt: room.createdAt ?? null,
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

function clearRoomExpiration(slug) {
  const timer = roomExpirationTimers.get(slug);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  roomExpirationTimers.delete(slug);
}

function getRoomExpirationMs(room) {
  if (room?.expiresAt) {
    const expiresAtMs = new Date(room.expiresAt).getTime();
    if (Number.isFinite(expiresAtMs)) {
      return expiresAtMs;
    }
  }

  if (room?.createdAt) {
    const createdAtMs = new Date(room.createdAt).getTime();
    if (Number.isFinite(createdAtMs)) {
      return createdAtMs + DEFAULT_SESSION_TTL_MS;
    }
  }

  return null;
}

function isRoomExpired(room) {
  const expiresAtMs = getRoomExpirationMs(room);
  if (expiresAtMs === null) {
    return false;
  }

  return expiresAtMs <= Date.now();
}

function scheduleRoomExpiration(slug) {
  const room = rooms.get(slug);
  const expiresAtMs = getRoomExpirationMs(room);
  if (expiresAtMs === null) {
    clearRoomExpiration(slug);
    return;
  }

  const remainingMs = expiresAtMs - Date.now();
  clearRoomExpiration(slug);

  if (remainingMs <= 0) {
    expireRoom(slug);
    return;
  }

  const timer = setTimeout(() => {
    expireRoom(slug);
  }, remainingMs);

  roomExpirationTimers.set(slug, timer);
}

function expireRoom(slug) {
  const room = rooms.get(slug);
  if (!room) {
    return;
  }

  clearRoomExpiration(slug);
  clearRoomCleanup(slug);

  room.roomStatus = "expired";
  room.gameState = {
    ...room.gameState,
    pendingVoteCount: 0,
    requiredVoteCount: 0,
  };

  const message = JSON.stringify({
    type: "room-expired",
    slug,
    roomStatus: room.roomStatus,
    message: "This bracket session has expired.",
  });

  room.clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
      client.ws.close();
    }
  });

  persistRoomSnapshot(slug, room, { gameStateChanged: true });
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
      createdAt: persisted?.createdAt
        ? new Date(persisted.createdAt)
        : new Date(),
      expiresAt: persisted?.expiresAt
        ? new Date(persisted.expiresAt)
        : persisted?.createdAt
          ? new Date(
              new Date(persisted.createdAt).getTime() + DEFAULT_SESSION_TTL_MS,
            )
          : new Date(Date.now() + DEFAULT_SESSION_TTL_MS),
      gameState: persisted?.gameState || {
        round: 0,
        currentMatch: 0,
        matchSize: DEFAULT_MATCH_SIZE,
        currentRoundItems: [],
        votesByMatch: {},
        pendingVoteCount: 0,
        roundWinners: [],
        winner: null,
      },
    };

    if (isRoomExpired(room)) {
      return null;
    }

    rooms.set(slug, room);
    scheduleRoomExpiration(slug);
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

  if (tally[leftIndex] > tally[rightIndex]) {
    return leftIndex;
  }

  return Math.random() < 0.5 ? leftIndex : rightIndex;
}

function getMatchSize(room) {
  const matchSize = Number(room?.gameState?.matchSize ?? DEFAULT_MATCH_SIZE);

  if (!Number.isFinite(matchSize) || matchSize < 2) {
    return DEFAULT_MATCH_SIZE;
  }

  return Math.floor(matchSize);
}

function getMatchWindow(currentRoundItems, matchIndex, matchSize) {
  const startIndex = matchIndex * matchSize;

  return {
    startIndex,
    items: currentRoundItems.slice(startIndex, startIndex + matchSize),
  };
}

function normalizeBracketProgression(room) {
  if (!room?.gameState) {
    return false;
  }

  let advanced = false;
  const matchSize = getMatchSize(room);

  while (true) {
    const currentRoundItems = room.gameState.currentRoundItems ?? [];

    if (currentRoundItems.length <= 1) {
      room.gameState = {
        ...room.gameState,
        currentRoundItems,
        currentMatch: 0,
        votesByMatch: {},
        pendingVoteCount: 0,
        requiredVoteCount: 0,
        roundWinners: [],
        lastWinner: null,
        winner: currentRoundItems[0] ?? null,
      };
      room.roomStatus = "completed";
      return true;
    }

    const match = room.gameState.currentMatch ?? 0;
    const round = room.gameState.round ?? 0;
    const matchKey = getMatchKey(round, match);
    const matchVotes = room.gameState.votesByMatch?.[matchKey] ?? {};
    const { startIndex, items: matchItems } = getMatchWindow(
      currentRoundItems,
      match,
      matchSize,
    );

    if (matchItems.length === 0) {
      return advanced;
    }

    if (matchItems.length === 1) {
      advanced = true;
      const nextRoundWinners = [...(room.gameState.roundWinners ?? [])];
      nextRoundWinners[match] = matchItems[0];

      const totalMatches = Math.ceil(currentRoundItems.length / matchSize);
      const completedMatches = nextRoundWinners.filter(Boolean).length;

      room.gameState.roundWinners = nextRoundWinners;
      room.gameState.pendingVoteCount = 0;
      room.gameState.requiredVoteCount = 0;

      if (completedMatches >= totalMatches) {
        const nextRoundItems = nextRoundWinners.filter(Boolean);

        if (nextRoundItems.length <= 1) {
          room.gameState = {
            ...room.gameState,
            currentRoundItems: nextRoundItems,
            currentMatch: 0,
            votesByMatch: {},
            pendingVoteCount: 0,
            requiredVoteCount: 0,
            roundWinners: [],
            lastWinner: matchItems[0] ?? null,
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
            requiredVoteCount: 0,
            roundWinners: [],
            lastWinner: matchItems[0] ?? null,
          };
        }
      } else {
        room.gameState.currentMatch = match + 1;
      }

      continue;
    }

    room.gameState.pendingVoteCount = Object.keys(matchVotes).length;
    room.gameState.requiredVoteCount = Math.max(
      1,
      Math.min(matchSize, room.participantIds.size),
    );
    advanced = true;

    return advanced;
  }
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

function attachWsRuntime(server, options = {}) {
  const wsPath = options.wsPath || "/ws";
  const wss = new WebSocketServer({ noServer: true });

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

    if (pathname === wsPath) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }

    if (typeof options.onUnknownUpgrade === "function") {
      options.onUnknownUpgrade(req, socket, head);
      return;
    }

    socket.destroy();
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
    if (!room) {
      ws.send(
        JSON.stringify({
          type: "room-expired",
          message: "This bracket session has expired.",
        }),
      );
      ws.close();
      return;
    }
    clearRoomCleanup(slug);

    if (isRoomExpired(room)) {
      expireRoom(slug);
      ws.close();
      return;
    }

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

        if (isRoomExpired(room)) {
          expireRoom(slug);
          return;
        }

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
          if (isRoomExpired(room)) {
            expireRoom(slug);
            return;
          }

          room.participantIds = new Set([
            ...Array.from(room.participantIds || []),
            ...Array.from(room.clients.values()).map(
              (entry) => entry.participantId || entry.id,
            ),
          ]);
          room.roomStatus = "started";
          room.gameState = {
            round: 0,
            currentMatch: 0,
            matchSize: DEFAULT_MATCH_SIZE,
            currentRoundItems: data.currentRoundItems ?? [],
            votesByMatch: {},
            pendingVoteCount: 0,
            requiredVoteCount: 0,
            roundWinners: [],
            winner: null,
          };
          normalizeBracketProgression(room);
          persistRoomSnapshot(slug, room, { gameStateChanged: true });
          broadcastGameUpdate(slug, {
            type: "game-started",
            roomStatus: room.roomStatus,
            gameState: room.gameState,
          });
        }

        if (data?.type === "vote") {
          if (isRoomExpired(room)) {
            expireRoom(slug);
            return;
          }

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
          const expectedRound = room.gameState.round ?? 0;
          const expectedMatch = room.gameState.currentMatch ?? 0;
          const matchSize = getMatchSize(room);

          if (!playerId || Number.isNaN(choice)) {
            return;
          }

          if (round !== expectedRound || match !== expectedMatch) {
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
          const { startIndex, items: matchItems } = getMatchWindow(
            currentRoundItems,
            match,
            matchSize,
          );
          const left = matchItems[0];
          const right = matchItems[1];

          if (!left) {
            return;
          }

          const activeParticipantCount = room.participantIds.size;
          const requiredVotes = Math.max(
            1,
            Math.min(matchSize, activeParticipantCount),
          );
          room.gameState.pendingVoteCount = Object.keys(matchVotes).length;
          room.gameState.requiredVoteCount = requiredVotes;

          if (room.gameState.pendingVoteCount >= requiredVotes) {
            const winningChoice = right
              ? resolveWinningChoice(matchVotes, startIndex, startIndex + 1)
              : startIndex;
            const winnerItem =
              right && winningChoice === startIndex + 1 ? right : left;
            const nextRoundWinners = [...(room.gameState.roundWinners ?? [])];
            nextRoundWinners[match] = winnerItem;

            const totalMatches = Math.ceil(
              currentRoundItems.length / matchSize,
            );
            const completedMatches = nextRoundWinners.filter(Boolean).length;

            room.gameState.roundWinners = nextRoundWinners;
            room.gameState.pendingVoteCount = 0;
            room.gameState.lastWinner = winnerItem;

            if (completedMatches >= totalMatches) {
              const nextRoundItems = nextRoundWinners.filter(Boolean);

              if (nextRoundItems.length <= 1) {
                room.gameState = {
                  ...room.gameState,
                  currentRoundItems: nextRoundItems,
                  currentMatch: 0,
                  votesByMatch: {},
                  pendingVoteCount: 0,
                  requiredVoteCount: 0,
                  roundWinners: [],
                  lastWinner: winnerItem,
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
                  requiredVoteCount: 0,
                  roundWinners: [],
                  lastWinner: winnerItem,
                };
              }
            } else {
              room.gameState.currentMatch =
                (room.gameState.currentMatch ?? 0) + 1;
            }

            normalizeBracketProgression(room);
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

  return wss;
}

module.exports = {
  attachWsRuntime,
};
