const { URL } = require("url");
const { WebSocketServer, WebSocket } = require("ws");
const { MongoClient } = require("mongodb");
const { timingSafeEqual } = require("crypto");

const rooms = new Map();
const roomCleanupTimers = new Map();
const roomExpirationTimers = new Map();
const roomInitializationPromises = new Map();
const roomPersistenceQueues = new Map();
const hostHandoffTimers = new Map();
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS || 300000);
// Grace period before an absent host loses the role. Long enough that a
// refresh, a tunnel change, or a phone locking the screen keeps the host where
// it is; short enough that the players still in the room are not stranded.
const HOST_HANDOFF_GRACE_MS = Number(
  process.env.HOST_HANDOFF_GRACE_MS || 15000,
);
const DEFAULT_SESSION_TTL_MS = Number(
  process.env.SESSION_TTL_MS || 30 * 60 * 1000,
);
const DEFAULT_MATCH_SIZE = 2;

// How long players get to vote once the intro clips have played out. Without
// this a single idle player holds the whole room, because a match now needs
// every connected player's vote to resolve.
const VOTE_WINDOW_MS = Number(process.env.VOTE_WINDOW_MS || 30000);
// Mirrors MAX_INTRO_CLIP_MS / STILL_CARD_MS / VS_MS in the client intro, so
// the server's deadline lands after the clips rather than during them.
const INTRO_MAX_CLIP_MS = 30000;
const INTRO_STILL_MS = 250;
const INTRO_VS_MS = 250;
const INTRO_BUFFER_MS = 1500;

const matchTimers = new Map();
// Waiting on the last player to reach the board is bounded: a phone that
// never reports in must not hold the vote window closed for everyone else.
const READY_GRACE_MS = Number(process.env.READY_GRACE_MS || 20000);
const readyTimers = new Map();

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
  const db = client.db("prod");
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
            hostClaimParticipantId: 1,
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
  const db = client.db("prod");
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

    clearHostHandoff(slug);
    // These fire against whatever `rooms` holds when they go off. Left
    // running, an evicted room's match timer force-advances the *rebuilt*
    // room minutes later - skipping a match the returning players were in
    // the middle of voting on.
    clearMatchTimer(slug);
    clearReadyTimer(slug);
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
  clearMatchTimer(slug);
  clearReadyTimer(slug);
  const room = rooms.get(slug);
  if (!room) {
    return;
  }

  clearRoomExpiration(slug);
  clearRoomCleanup(slug);
  clearHostHandoff(slug);

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
      // Who made the room, as recorded by the join endpoint when they
      // redeemed their claim. Read-only here.
      creatorParticipantId: persisted?.hostClaimParticipantId ?? null,
      hostParticipantId:
        persisted?.hostClaimParticipantId ?? persisted?.hostParticipantId ?? null,
      // matchKey -> Set(participantId) of players whose board is up for it.
      readyByMatch: new Map(),
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

// participantId travels in the clear (it keys votesByMatch, which is
// broadcast room-wide) so it proves nothing on its own. The token minted by
// POST /api/sessions/[slug] is the actual credential and is checked here
// before a socket is allowed to vote or start the game.
// Returns the verification result together with the room's persisted host,
// which the join endpoint may have set moments ago - after this room was
// already built in memory. Same read either way, so the host lookup is free.
async function verifyParticipantToken(slug, participantId, token) {
  const denied = { ok: false, hostParticipantId: null, creatorParticipantId: null };

  if (!participantId || typeof token !== "string" || token.length === 0) {
    return denied;
  }

  const projectionKey = `participantLookup.${participantId}.participantToken`;

  try {
    const session = await withSessionsCollection((sessions) =>
      sessions.findOne(
        { slug },
        {
          projection: {
            [projectionKey]: 1,
            hostParticipantId: 1,
            hostClaimParticipantId: 1,
          },
        },
      ),
    );

    // A null result means Mongo is unreachable or unconfigured. Sessions can
    // only exist in Mongo, so there is no legitimate client to admit here.
    if (!session) {
      return denied;
    }

    const hostParticipantId =
      typeof session.hostParticipantId === "string" && session.hostParticipantId
        ? session.hostParticipantId
        : null;
    const creatorParticipantId =
      typeof session.hostClaimParticipantId === "string" &&
      session.hostClaimParticipantId
        ? session.hostClaimParticipantId
        : null;

    const stored = session?.participantLookup?.[participantId]?.participantToken;
    if (typeof stored !== "string" || stored.length === 0) {
      return { ok: false, hostParticipantId, creatorParticipantId };
    }

    const storedBuffer = Buffer.from(stored, "utf8");
    const providedBuffer = Buffer.from(token, "utf8");
    if (storedBuffer.length !== providedBuffer.length) {
      return { ok: false, hostParticipantId, creatorParticipantId };
    }

    return {
      ok: timingSafeEqual(storedBuffer, providedBuffer),
      hostParticipantId,
      creatorParticipantId,
    };
  } catch (error) {
    console.error("Failed to verify participant token:", error);
    return denied;
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

// After a match resolves to winnerValue, folds it into nextRoundWinners and
// either finishes the game, advances to the next round, or reports that the
// round isn't complete yet (the caller is then responsible for moving on to
// the next match within the round). Mutates room.gameState directly. Shared
// by normalizeBracketProgression's bye-skipping loop and
// tallyAndAdvanceMatch's live-vote resolution.
function applyRoundWinner(room, { matchSize, currentRoundItems, nextRoundWinners, winnerValue }) {
  const totalMatches = Math.ceil(currentRoundItems.length / matchSize);
  const completedMatches = nextRoundWinners.filter(Boolean).length;

  if (completedMatches < totalMatches) {
    return false;
  }

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
      lastWinner: winnerValue,
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
      lastWinner: winnerValue,
    };
  }

  return true;
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
    const { items: matchItems } = getMatchWindow(
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

      room.gameState.roundWinners = nextRoundWinners;
      room.gameState.pendingVoteCount = 0;
      room.gameState.requiredVoteCount = 0;

      const roundFinished = applyRoundWinner(room, {
        matchSize,
        currentRoundItems,
        nextRoundWinners,
        winnerValue: matchItems[0] ?? null,
      });

      if (!roundFinished) {
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

function getActiveVoterCount(room) {
  return getExpectedReadyIds(room).size;
}

// Tallies the live match and advances the bracket if the quorum is met.
// Derives everything from room state so both an incoming vote and a
// disconnect (which lowers the quorum) can drive it. Returns true if the
// board moved on.
function tallyAndAdvanceMatch(slug, room, options = {}) {
  if (!room?.gameState) {
    return false;
  }

  const force = Boolean(options.force);

  let advanced = false;
  const matchSize = getMatchSize(room);
  const round = room.gameState.round ?? 0;
  const match = room.gameState.currentMatch ?? 0;
  const matchKey = getMatchKey(round, match);
  const matchVotes = room.gameState.votesByMatch?.[matchKey] ?? {};

  const currentRoundItems = room.gameState.currentRoundItems ?? [];
  const { startIndex, items: matchItems } = getMatchWindow(
    currentRoundItems,
    match,
    matchSize,
  );
  const left = matchItems[0];
  const right = matchItems[1];

  if (!left) {
    return false;
  }

  // Every connected player gets a say. The quorum is the number of
  // authenticated sockets actually in the room, so a 10-player room
  // needs all 10 votes and is then decided by majority; an exact
  // split falls through to resolveWinningChoice's coin flip.
  const requiredVotes = Math.max(1, getActiveVoterCount(room));
  room.gameState.pendingVoteCount = Object.keys(matchVotes).length;
  room.gameState.requiredVoteCount = requiredVotes;

  // `force` is the timer expiring or the host overriding: settle with whatever
  // votes are in rather than waiting for a quorum that may never arrive.
  if (force || room.gameState.pendingVoteCount >= requiredVotes) {
    advanced = true;
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

    room.gameState.roundWinners = nextRoundWinners;
    room.gameState.pendingVoteCount = 0;
    room.gameState.lastWinner = winnerItem;

    const roundFinished = applyRoundWinner(room, {
      matchSize,
      currentRoundItems,
      nextRoundWinners,
      winnerValue: winnerItem,
    });

    if (!roundFinished) {
      room.gameState.currentMatch = (room.gameState.currentMatch ?? 0) + 1;
    }

    normalizeBracketProgression(room);

    // The advance path zeroes requiredVoteCount, so republish the quorum for
    // the match that just became current - otherwise the board shows a stale
    // target until the first vote of the new match arrives.
    if ((room.gameState.currentRoundItems ?? []).length > 1) {
      room.gameState.requiredVoteCount = Math.max(1, getActiveVoterCount(room));
      // A new matchup means a new intro on every client, so the countdown
      // waits for them again rather than carrying over from the last one.
      armMatchWhenReady(slug, room);
    } else {
      clearMatchTimer(slug);
      clearReadyTimer(slug);
      room.gameState.matchDeadline = null;
      room.gameState.awaitingPlayers = false;
    }
  }

  return advanced;
}

function estimateIntroMs(matchItems) {
  return (
    matchItems.reduce((total, item) => {
      if (!item) {
        return total;
      }

      if (item.mediaType === "video" || /\/video\/upload\//.test(item.url ?? "")) {
        const clipMs = Number(item.duration) > 0 ? Number(item.duration) * 1000 : INTRO_MAX_CLIP_MS;
        return total + Math.min(clipMs, INTRO_MAX_CLIP_MS);
      }

      return total + INTRO_STILL_MS;
    }, 0) +
    INTRO_VS_MS +
    INTRO_BUFFER_MS
  );
}

// The readiness barrier.
//
// The vote window used to start the moment a match became current, sized by a
// server-side guess at how long the intro would take on the client. Every
// player who took longer than the guess - a slow phone, a cold video, a tab
// that was backgrounded - lost part of their window, and a player who took
// much longer could arrive after the match had already been settled by the
// others. Their vote was simply never counted.
//
// So the window no longer starts on a guess. Each client reports when its
// board is actually up for a given match, and the countdown starts when the
// last one checks in. READY_GRACE_MS bounds the wait so one client that never
// reports cannot hold the room.

function clearReadyTimer(slug) {
  const timer = readyTimers.get(slug);
  if (timer) {
    clearTimeout(timer);
    readyTimers.delete(slug);
  }
}

// Who the room is waiting on: every verified socket currently connected.
// Deliberately the same set getActiveVoterCount derives the quorum from, so
// the room never waits on someone whose vote it would not require anyway.
function getExpectedReadyIds(room) {
  const ids = new Set();
  room.clients.forEach((client) => {
    if (client.authenticated && client.participantId) {
      ids.add(client.participantId);
    }
  });
  return ids;
}

function getReadySet(room, matchKey) {
  if (!room.readyByMatch) {
    room.readyByMatch = new Map();
  }
  let set = room.readyByMatch.get(matchKey);
  if (!set) {
    set = new Set();
    room.readyByMatch.set(matchKey, set);
  }
  return set;
}

function currentMatchKey(room) {
  return getMatchKey(room.gameState?.round ?? 0, room.gameState?.currentMatch ?? 0);
}

// Publishes the barrier so the board can say who it is waiting for instead of
// showing a countdown that has not started.
function publishReadyState(room) {
  if (!room.gameState) {
    return;
  }

  const expected = getExpectedReadyIds(room);
  const ready = getReadySet(room, currentMatchKey(room));
  let readyCount = 0;
  expected.forEach((id) => {
    if (ready.has(id)) readyCount += 1;
  });

  room.gameState.readyParticipantCount = readyCount;
  room.gameState.requiredReadyCount = expected.size;
}

// True when everyone the room is waiting on has reported in. An empty room
// (everybody dropped mid-intro) counts as ready so the match can still settle.
function everyoneReady(room) {
  const expected = getExpectedReadyIds(room);
  if (expected.size === 0) {
    return true;
  }
  const ready = getReadySet(room, currentMatchKey(room));
  for (const id of expected) {
    if (!ready.has(id)) {
      return false;
    }
  }
  return true;
}

// Called wherever a new match becomes current. Holds the countdown closed and
// starts the bounded fallback clock.
function armMatchWhenReady(slug, room) {
  clearMatchTimer(slug);
  clearReadyTimer(slug);

  if (!room?.gameState || room.roomStatus !== "started") {
    return;
  }

  const currentRoundItems = room.gameState.currentRoundItems ?? [];
  if (currentRoundItems.length <= 1) {
    room.gameState.matchDeadline = null;
    room.gameState.awaitingPlayers = false;
    return;
  }

  room.gameState.matchDeadline = null;
  room.gameState.awaitingPlayers = true;
  publishReadyState(room);

  // Already there - a single player whose board was up before the advance, or
  // a room that emptied out - so there is nothing to wait for.
  if (everyoneReady(room)) {
    armMatchTimer(slug, room, { introConfirmed: true });
    return;
  }

  const { items: matchItems } = getMatchWindow(
    currentRoundItems,
    room.gameState.currentMatch ?? 0,
    getMatchSize(room),
  );

  // The fallback has to outlast the intro itself, or it would fire while
  // every client is still legitimately playing the clips.
  const graceMs = estimateIntroMs(matchItems) + READY_GRACE_MS;
  readyTimers.set(
    slug,
    setTimeout(() => {
      readyTimers.delete(slug);
      const liveRoom = rooms.get(slug);
      if (!liveRoom || liveRoom.roomStatus !== "started") {
        return;
      }

      armMatchTimer(slug, liveRoom, { introConfirmed: false });
      broadcastGameUpdate(slug, {
        type: "vote-update",
        roomStatus: liveRoom.roomStatus,
        gameState: publicGameState(liveRoom),
      });
      persistRoomSnapshot(slug, liveRoom);
    }, graceMs),
  );
}

// A client reporting that its board is up, or the set of players we are
// waiting on changing underneath us (someone left, someone joined).
function noteReadyChange(slug, room, { broadcast = true } = {}) {
  if (!room?.gameState || room.roomStatus !== "started") {
    return false;
  }

  // The countdown is already running; readiness no longer gates anything.
  if (!room.gameState.awaitingPlayers) {
    return false;
  }

  publishReadyState(room);

  if (!everyoneReady(room)) {
    if (broadcast) {
      broadcastGameUpdate(slug, {
        type: "vote-update",
        roomStatus: room.roomStatus,
        gameState: publicGameState(room),
      });
    }
    return false;
  }

  armMatchTimer(slug, room, { introConfirmed: true });
  if (broadcast) {
    broadcastGameUpdate(slug, {
      type: "vote-update",
      roomStatus: room.roomStatus,
      gameState: publicGameState(room),
    });
  }
  return true;
}

function clearMatchTimer(slug) {
  const timer = matchTimers.get(slug);
  if (timer) {
    clearTimeout(timer);
    matchTimers.delete(slug);
  }
}

// Arms the deadline for whichever match is now current and publishes it so
// every client can render the same countdown.
function armMatchTimer(slug, room, options = {}) {
  clearMatchTimer(slug);
  clearReadyTimer(slug);

  if (!room?.gameState || room.roomStatus !== "started") {
    return;
  }

  const matchSize = getMatchSize(room);
  const currentRoundItems = room.gameState.currentRoundItems ?? [];
  if (currentRoundItems.length <= 1) {
    room.gameState.matchDeadline = null;
    return;
  }

  const { items: matchItems } = getMatchWindow(
    currentRoundItems,
    room.gameState.currentMatch ?? 0,
    matchSize,
  );
  if (!matchItems[0]) {
    return;
  }

  // Everyone confirmed their board is up, so the window is pure voting time.
  // The unconfirmed path still has to cover an intro that may still be
  // playing on a client that never reported in.
  const durationMs =
    (options.introConfirmed ? 0 : estimateIntroMs(matchItems)) + VOTE_WINDOW_MS;
  room.gameState.matchDeadline = Date.now() + durationMs;
  room.gameState.awaitingPlayers = false;

  matchTimers.set(
    slug,
    setTimeout(() => {
      matchTimers.delete(slug);
      const liveRoom = rooms.get(slug);
      if (!liveRoom || liveRoom.roomStatus !== "started") {
        return;
      }

      // Time is up: settle with whatever votes were cast. A match with no
      // votes at all still resolves, via resolveWinningChoice's coin flip.
      const advanced = tallyAndAdvanceMatch(slug, liveRoom, { force: true });
      broadcastGameUpdate(slug, {
        type: "vote-update",
        roomStatus: liveRoom.roomStatus,
        gameState: publicGameState(liveRoom),
      });
      persistRoomSnapshot(slug, liveRoom, { gameStateChanged: advanced });
      if (advanced) {
        void recordGameHistoryIfNeeded(slug, liveRoom);
      }
    }, durationMs),
  );
}

// Keeps the room alive while people are actually playing. The TTL used to run
// from session creation, so a long bracket (30s clips x 15 matches) could hit
// the wall mid-game and hard-close the room.
function touchRoomExpiry(slug, room) {
  if (!room) {
    return;
  }

  const extended = new Date(Date.now() + DEFAULT_SESSION_TTL_MS);
  const current = room.expiresAt ? new Date(room.expiresAt).getTime() : 0;
  if (extended.getTime() > current) {
    room.expiresAt = extended;
    scheduleRoomExpiration(slug);
  }
}

// Choices stay hidden until the match is settled, so nobody can see the score
// before deciding. Voter ids are still sent - the board needs them to show who
// has locked in and who it is waiting on.
function publicGameState(room) {
  const gameState = room?.gameState;
  if (!gameState) {
    return gameState;
  }

  const round = gameState.round ?? 0;
  const match = gameState.currentMatch ?? 0;
  const liveKey = getMatchKey(round, match);
  const liveVotes = gameState.votesByMatch?.[liveKey];

  if (!liveVotes) {
    return gameState;
  }

  const redacted = {};
  Object.entries(liveVotes).forEach(([participantId, vote]) => {
    redacted[participantId] = { at: vote?.at ?? 0 };
  });

  return {
    ...gameState,
    votesByMatch: { ...gameState.votesByMatch, [liveKey]: redacted },
  };
}

function isParticipantConnected(room, participantId) {
  if (!participantId) {
    return false;
  }

  for (const client of room.clients.values()) {
    if (client.authenticated && client.participantId === participantId) {
      return true;
    }
  }

  return false;
}

// The host role, resolved from first principles rather than from whoever got
// here first: the person who created the room holds it whenever they are in
// it. If they are not - closed the tab, lost signal - the existing handoff
// grace hands the role to someone still present, and this hands it straight
// back the moment the creator returns and verifies.
function resolveHost(room, creatorParticipantId, fallbackParticipantId) {
  if (creatorParticipantId) {
    room.creatorParticipantId = creatorParticipantId;
  }

  const creatorId = room.creatorParticipantId;
  if (creatorId && isParticipantConnected(room, creatorId)) {
    room.hostParticipantId = creatorId;
    return;
  }

  assignHostIfMissing(room, fallbackParticipantId);
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

function isHostConnected(room) {
  return isParticipantConnected(room, room?.hostParticipantId);
}

function clearHostHandoff(slug) {
  const timer = hostHandoffTimers.get(slug);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  hostHandoffTimers.delete(slug);
}

// The host id is persisted, so without a handoff a host who never comes back -
// a closed tab, a new participant id after storage is cleared - leaves the room
// permanently unstartable for everyone still in it.
function scheduleHostHandoff(slug) {
  if (hostHandoffTimers.has(slug)) {
    return;
  }

  const timer = setTimeout(() => {
    hostHandoffTimers.delete(slug);

    const room = rooms.get(slug);
    if (!room || isHostConnected(room)) {
      return;
    }

    // Earliest arrival wins, so the handoff is predictable rather than
    // whichever socket the Map happens to yield first.
    const nextHost = Array.from(room.clients.values())
      .filter(
        (client) =>
          client.authenticated &&
          typeof client.participantId === "string" &&
          client.participantId.length > 0,
      )
      .sort((left, right) => left.joinedAt - right.joinedAt)[0];

    if (!nextHost || nextHost.participantId === room.hostParticipantId) {
      return;
    }

    room.hostParticipantId = nextHost.participantId;
    persistRoomSnapshot(slug, room);
    broadcastRoomState(slug);
  }, HOST_HANDOFF_GRACE_MS);

  hostHandoffTimers.set(slug, timer);
}

// Called wherever the set of authenticated sockets changes: either the host is
// present and keeps the role, or the grace clock starts.
function syncHostPresence(slug, room) {
  if (!room.hostParticipantId || isHostConnected(room)) {
    clearHostHandoff(slug);
    return;
  }

  scheduleHostHandoff(slug);
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
    gameState: rooms.get(slug) ? publicGameState(rooms.get(slug)) : null,
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
    // Room setup below awaits Mongo, and on a cold connection that can take
    // seconds. The listener has to exist before then or anything the client
    // sends first - including its own join/auth - is dropped on the floor,
    // so buffer here and drain once the real handler is installed.
    const bufferedMessages = [];
    let onClientMessage = (raw) => {
      bufferedMessages.push(raw);
    };
    ws.on("message", (raw) => onClientMessage(raw));

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
      // Flipped only by a valid "auth" message. Until then the socket may
      // observe room state but may not vote or start the game.
      authenticated: false,
    };

    // participantIds is only extended once a socket proves who it is (see the
    // "auth" handler); an unverified query param must not grow the roster.

    room.clients.set(ws, client);
    persistRoomSnapshot(slug, room);
    broadcastRoomState(slug);

    const handleClientMessage = (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (isRoomExpired(room)) {
          expireRoom(slug);
          return;
        }

        if (data?.type === "auth") {
          const claimedId =
            typeof data.participantId === "string" ? data.participantId : null;

          void verifyParticipantToken(
            slug,
            claimedId,
            data.participantToken,
          ).then(({
            ok,
            hostParticipantId: persistedHostId,
            creatorParticipantId: persistedCreatorId,
          }) => {
            const entry = room.clients.get(ws);
            if (!entry) {
              return;
            }

            if (!ok) {
              ws.send(
                JSON.stringify({
                  type: "auth-denied",
                  message: "Could not verify your player identity.",
                }),
              );
              return;
            }

            entry.participantId = claimedId;
            entry.authenticated = true;
            room.clients.set(ws, entry);
            // The room may have been built in memory before the creator
            // redeemed their claim, so take the stored answer over the one
            // this room started with.
            if (persistedHostId && !room.hostParticipantId) {
              room.hostParticipantId = persistedHostId;
            }
            resolveHost(room, persistedCreatorId, claimedId);
            room.participantIds.add(claimedId);
            // Covers the stale case too: a host id loaded from Mongo whose
            // owner never reconnects would otherwise hold the room forever.
            syncHostPresence(slug, room);

            ws.send(
              JSON.stringify({ type: "auth-ok", participantId: claimedId }),
            );

            // Joining changes how many votes the live match needs - and, if
            // the barrier is still closed, adds one more board to wait for.
            if (room.roomStatus === "started") {
              // Timers live in this process, not in Mongo, so a room rebuilt
              // from the database has none: evicted while everyone was away,
              // or the runtime restarted under a deploy. Its persisted
              // deadline is already in the past and nothing will ever fire
              // against it, so the match hangs until every remaining player
              // votes - and if one of them never comes back, forever.
              // Re-open the barrier instead: the returning boards report in
              // and the window is armed again from here.
              if (!matchTimers.has(slug) && !readyTimers.has(slug)) {
                armMatchWhenReady(slug, room);
              }
              publishReadyState(room);
              const advanced = tallyAndAdvanceMatch(slug, room);
              broadcastGameUpdate(slug, {
                type: "vote-update",
                roomStatus: room.roomStatus,
                gameState: publicGameState(room),
              });
              if (advanced) {
                void recordGameHistoryIfNeeded(slug, room);
              }
            }

            persistRoomSnapshot(slug, room);
            broadcastRoomState(slug);
          });
        }

        if (data?.type === "join") {
          // Display name only. Identity comes from the verified "auth"
          // message; a client-supplied participantId is not trusted here.
          const incomingParticipantId = room.clients.get(ws)?.participantId;
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

          room.clients.set(ws, {
            ...room.clients.get(ws),
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

          const requester = room.clients.get(ws);
          if (!requester?.authenticated) {
            ws.send(
              JSON.stringify({
                type: "start-denied",
                // Distinct from "you are not the host": this one clears once
                // the client presents its token, so it is worth retrying.
                unverified: true,
                message: "Could not verify your player identity.",
              }),
            );
            return;
          }

          const requesterId = requester.participantId;
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
            readyParticipantCount: 0,
            requiredReadyCount: 0,
            awaitingPlayers: true,
            roundWinners: [],
            winner: null,
            matchHistory: [],
          };
          // Reset per-game bookkeeping so "Play Again" on the same room
          // slug records a fresh, separate gameResults doc for this run.
          room.historyRecorded = false;
          room.gameStartedAt = new Date();
          normalizeBracketProgression(room);
          // Publishes requiredVoteCount for the opening match, so the board
          // shows the real target instead of a stale one until someone votes.
          tallyAndAdvanceMatch(slug, room);
          room.readyByMatch = new Map();
          armMatchWhenReady(slug, room);
          touchRoomExpiry(slug, room);
          persistRoomSnapshot(slug, room, { gameStateChanged: true });
          void recordGameHistoryIfNeeded(slug, room);
          broadcastGameUpdate(slug, {
            type: "game-started",
            roomStatus: room.roomStatus,
            gameState: publicGameState(room),
          });
        }

        if (data?.type === "force-advance") {
          const requester = room.clients.get(ws);
          if (
            !requester?.authenticated ||
            (room.hostParticipantId &&
              requester.participantId !== room.hostParticipantId)
          ) {
            ws.send(
              JSON.stringify({
                type: "force-denied",
                message: "Only the room host can advance the match.",
              }),
            );
            return;
          }

          if (room.roomStatus !== "started") {
            return;
          }

          const advanced = tallyAndAdvanceMatch(slug, room, { force: true });
          touchRoomExpiry(slug, room);
          broadcastGameUpdate(slug, {
            type: "vote-update",
            roomStatus: room.roomStatus,
            gameState: publicGameState(room),
          });
          persistRoomSnapshot(slug, room, { gameStateChanged: advanced });
          if (advanced) {
            void recordGameHistoryIfNeeded(slug, room);
          }
        }

        // "my board is up for this match" - the client half of the readiness
        // barrier. Only counts for the live match: a late report for a match
        // that has already settled says nothing about the current one.
        if (data?.type === "ready") {
          const reporter = room.clients.get(ws);
          if (!reporter?.authenticated || !reporter.participantId) {
            return;
          }

          if (room.roomStatus !== "started" || !room.gameState) {
            return;
          }

          const round =
            typeof data.round === "number" ? data.round : room.gameState.round ?? 0;
          const match =
            typeof data.match === "number"
              ? data.match
              : room.gameState.currentMatch ?? 0;

          if (
            round !== (room.gameState.round ?? 0) ||
            match !== (room.gameState.currentMatch ?? 0)
          ) {
            return;
          }

          getReadySet(room, getMatchKey(round, match)).add(reporter.participantId);
          touchRoomExpiry(slug, room);
          if (noteReadyChange(slug, room)) {
            persistRoomSnapshot(slug, room);
          }
        }

        if (data?.type === "vote") {
          if (isRoomExpired(room)) {
            expireRoom(slug);
            return;
          }

          // force-advance already guards this; the vote path did not, so a
          // late vote - a queued one flushed on reconnect, a double tap as
          // the final match settled - was tallied against the finished
          // bracket. That appended a phantom match in which the winner beat
          // itself, persisted it, and credited the winner an extra win in
          // every stat built from the match log.
          if (room.roomStatus !== "started") {
            return;
          }

          const voter = room.clients.get(ws);
          if (!voter?.authenticated) {
            // Dropping this silently is how an unverified player spends a
            // whole game tapping cards that never register - and, because the
            // quorum only counts authenticated sockets, watching everyone
            // else's votes decide every match. Tell the client so it can
            // present its token and replay the vote.
            ws.send(
              JSON.stringify({
                type: "vote-denied",
                message: "Could not verify your player identity.",
                vote: { round: data.round, match: data.match, choice: data.choice },
              }),
            );
            return;
          }

          const playerId = voter.participantId;
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

          // Only the two indices belonging to the live match are votable.
          // Without this, any number is accepted and resolveWinningChoice
          // tallies everything that is not rightIndex as a vote for left, so
          // a bogus choice silently became a left vote.
          const voteStartIndex = match * matchSize;
          if (choice !== voteStartIndex && choice !== voteStartIndex + 1) {
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

          touchRoomExpiry(slug, room);
          tallyAndAdvanceMatch(slug, room);

          broadcastGameUpdate(slug, {
            type: "vote-update",
            roomStatus: room.roomStatus,
            vote: data,
            gameState: publicGameState(room),
          });
          persistRoomSnapshot(slug, room, { gameStateChanged: true });
          void recordGameHistoryIfNeeded(slug, room);
        }

      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    };

    onClientMessage = handleClientMessage;
    bufferedMessages.splice(0).forEach(handleClientMessage);

    ws.on("close", () => {
      const currentRoom = rooms.get(slug);

      if (!currentRoom) {
        return;
      }

      currentRoom.clients.delete(ws);

      if (currentRoom.clients.size === 0) {
        // Nobody is left to promote, and the room may be evicted before anyone
        // returns. Whoever authenticates next restarts the grace clock.
        clearHostHandoff(slug);
        persistRoomSnapshot(slug, currentRoom);
        scheduleRoomCleanup(slug);
      } else {
        syncHostPresence(slug, currentRoom);

        // Leaving lowers the quorum, so the players still here may already
        // have decided the match. Without this re-tally one person closing
        // their tab mid-match would stall the room until they came back.
        if (currentRoom.roomStatus === "started") {
          // Same reasoning for the readiness barrier: the room must stop
          // waiting on a board that has gone away, or the last player left
          // sits behind a countdown that never starts.
          noteReadyChange(slug, currentRoom, { broadcast: false });
          const advanced = tallyAndAdvanceMatch(slug, currentRoom);
          broadcastGameUpdate(slug, {
            type: "vote-update",
            roomStatus: currentRoom.roomStatus,
            gameState: publicGameState(currentRoom),
          });
          persistRoomSnapshot(slug, currentRoom, {
            gameStateChanged: advanced,
          });
          if (advanced) {
            void recordGameHistoryIfNeeded(slug, currentRoom);
          }
        }

        broadcastRoomState(slug);
      }
    });
  });

  return wss;
}

module.exports = {
  attachWsRuntime,
};


