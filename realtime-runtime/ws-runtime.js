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
            hostParticipantId: 1,
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
    hostParticipantId: room.hostParticipantId ?? null,
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

let gameResultsIndexesEnsured = false;

async function ensureGameResultsIndexes(gameResults) {
  if (gameResultsIndexesEnsured) {
    return;
  }

  gameResultsIndexesEnsured = true;

  try {
    await gameResults.createIndex({ bracketId: 1 });
    await gameResults.createIndex({ hostUserId: 1 });
    await gameResults.createIndex({ participantUserIds: 1 });
  } catch (error) {
    console.error("Failed to ensure gameResults indexes:", error);
  }
}

async function withGameResultsCollection(callback) {
  const clientPromise = getMongoClientPromise();
  if (!clientPromise) {
    return null;
  }

  const client = await clientPromise;
  const db = client.db("test");
  const gameResults = db.collection("gameResults");
  await ensureGameResultsIndexes(gameResults);
  return callback(gameResults);
}

function buildItemResults(matchHistory, winnerItemId) {
  const stats = new Map();

  matchHistory.forEach((entry) => {
    (entry.items ?? []).forEach((item) => {
      if (!item?.id) {
        return;
      }

      if (!stats.has(item.id)) {
        stats.set(item.id, {
          itemId: item.id,
          title: item.title ?? item.id,
          wins: 0,
          losses: 0,
          roundReached: entry.round,
        });
      }

      const stat = stats.get(item.id);
      stat.roundReached = Math.max(stat.roundReached, entry.round);

      if (item.id === entry.winnerItemId) {
        stat.wins += 1;
      } else {
        stat.losses += 1;
      }
    });
  });

  return Array.from(stats.values()).map((stat) => ({
    ...stat,
    isWinner: stat.itemId === winnerItemId,
  }));
}

// Records a durable, non-expiring summary of a completed game into
// `gameResults`, since `sessions` documents are TTL-deleted ~30 minutes
// after creation (see SESSION_TTL_MS) regardless of whether the game
// finished. Guarded by room.historyRecorded so "Play Again" (which
// re-runs the same slug through another full game) produces one
// gameResults doc per completed game rather than duplicates.
async function recordGameHistoryIfNeeded(slug, room) {
  if (room.roomStatus !== "completed" || room.historyRecorded) {
    return;
  }

  room.historyRecorded = true;

  const matchHistory = room.gameState?.matchHistory ?? [];
  const winner = room.gameState?.winner ?? null;

  if (!winner?.id) {
    return;
  }

  try {
    const sessionInfo = await withSessionsCollection((sessions) =>
      sessions.findOne(
        { slug },
        {
          projection: {
            participantLookup: 1,
            hostUserId: 1,
            bracket: 1,
          },
        },
      ),
    );

    const participantLookup = sessionInfo?.participantLookup ?? {};
    const resolveAuthUserId = (participantId) =>
      participantLookup?.[participantId]?.authUserId ?? null;

    const hostUserId =
      resolveAuthUserId(room.hostParticipantId) ??
      sessionInfo?.hostUserId ??
      null;

    const participantUserIdSet = new Set();
    let guestParticipantCount = 0;

    Array.from(room.participantIds || []).forEach((participantId) => {
      const authUserId = resolveAuthUserId(participantId);
      if (authUserId) {
        participantUserIdSet.add(authUserId);
      } else {
        guestParticipantCount += 1;
      }
    });

    // Only logged-in participants' picks are retained here — anonymous
    // guest participantIds are never written into this durable collection,
    // even though they're already present in the ephemeral `sessions` doc.
    const participantPicks = [];
    matchHistory.forEach((entry) => {
      (entry.votes ?? []).forEach((vote) => {
        const authUserId = resolveAuthUserId(vote.participantId);
        if (!authUserId) {
          return;
        }

        participantPicks.push({
          authUserId,
          round: entry.round,
          match: entry.match,
          pickedItemId: vote.itemId,
          wasMatchWinner: vote.itemId === entry.winnerItemId,
        });
      });
    });

    const doc = {
      slug,
      bracketId: sessionInfo?.bracket?._id
        ? String(sessionInfo.bracket._id)
        : null,
      bracketTitle: sessionInfo?.bracket?.title ?? null,
      hostUserId,
      participantUserIds: Array.from(participantUserIdSet),
      guestParticipantCount,
      winnerItemId: winner.id,
      winnerItemTitle: winner.title ?? null,
      itemResults: buildItemResults(matchHistory, winner.id),
      matchLog: matchHistory.map(({ votes: _votes, ...rest }) => rest),
      participantPicks,
      roundCount: (room.gameState?.round ?? 0) + 1,
      startedAt: room.gameStartedAt ?? room.createdAt ?? new Date(),
      completedAt: new Date(),
    };

    await withGameResultsCollection((gameResults) =>
      gameResults.insertOne(doc),
    );
  } catch (error) {
    console.error("Failed to record game history:", error);
  }
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
      hostParticipantId: persisted?.hostParticipantId ?? null,
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
        matchHistory: [],
      },
      historyRecorded: false,
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

      room.gameState.matchHistory = [
        ...(room.gameState.matchHistory ?? []),
        {
          round,
          match,
          items: [{ id: matchItems[0].id, title: matchItems[0].title }],
          voteCounts: {},
          votes: [],
          winnerItemId: matchItems[0].id,
          wasBye: true,
        },
      ];

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

function assignHostIfMissing(room, participantId) {
  if (
    room.hostParticipantId ||
    typeof participantId !== "string" ||
    participantId.length === 0
  ) {
    return;
  }

  room.hostParticipantId = participantId;
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
    hostParticipantId: rooms.get(slug)?.hostParticipantId ?? null,
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
      assignHostIfMissing(room, queryParticipantId);
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

          assignHostIfMissing(room, incomingParticipantId);
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

          const requesterId = room.clients.get(ws)?.participantId;
          if (
            room.hostParticipantId &&
            requesterId !== room.hostParticipantId
          ) {
            ws.send(
              JSON.stringify({
                type: "start-denied",
                message: "Only the room host can start the game.",
              }),
            );
            return;
          }

          room.participantIds = new Set([
            ...Array.from(room.participantIds || []),
            ...Array.from(room.clients.values())
              .map((entry) => entry.participantId)
              .filter(
                (participantId) =>
                  typeof participantId === "string" && participantId.length > 0,
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
            matchHistory: [],
          };
          // Reset per-game bookkeeping so "Play Again" on the same room
          // slug records a fresh, separate gameResults doc for this run.
          room.historyRecorded = false;
          room.gameStartedAt = new Date();
          normalizeBracketProgression(room);
          persistRoomSnapshot(slug, room, { gameStateChanged: true });
          void recordGameHistoryIfNeeded(slug, room);
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
            room.clients.get(ws)?.participantId || room.clients.get(ws)?.id;
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

            const pickedItemFor = (vote) =>
              right && vote?.choice === startIndex + 1 ? right : left;
            const voteCounts = {};
            const matchHistoryVotes = [];
            Object.entries(matchVotes).forEach(([voterId, vote]) => {
              const pickedItem = pickedItemFor(vote);
              if (!pickedItem?.id) {
                return;
              }
              voteCounts[pickedItem.id] = (voteCounts[pickedItem.id] ?? 0) + 1;
              matchHistoryVotes.push({
                participantId: voterId,
                itemId: pickedItem.id,
              });
            });

            room.gameState.matchHistory = [
              ...(room.gameState.matchHistory ?? []),
              {
                round,
                match,
                items: right
                  ? [
                      { id: left.id, title: left.title },
                      { id: right.id, title: right.title },
                    ]
                  : [{ id: left.id, title: left.title }],
                voteCounts,
                votes: matchHistoryVotes,
                winnerItemId: winnerItem.id,
                wasBye: false,
              },
            ];

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
          void recordGameHistoryIfNeeded(slug, room);
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


