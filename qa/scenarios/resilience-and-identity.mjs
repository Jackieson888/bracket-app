// What happens when the room is not behaving: people arriving late, tabs
// dying mid-game, the host vanishing, and sockets that never proved who they
// are.
import {
  api,
  config,
  createSession,
  joinSession,
  makeItems,
  Player,
  scenario,
  sleep,
  waitForAll,
  waitForSnapshot,
} from "../lib/harness.mjs";
import WebSocket from "ws";

scenario(
  "late-join-lockout",
  { covers: "Once a game is under way, newcomers are turned away" },
  async (t) => {
    const items = makeItems(4, "late");
    const slug = await createSession({ title: "QA Late", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "LateHost" });
    t.cleanupPlayer(host);
    const known = await Player.enter(slug, { name: "LateKnown" });
    t.cleanupPlayer(known);

    await waitForAll([host, known], (player) => player.roster().length === 2, {
      label: "both in the room before start",
    });
    host.startGame(items);
    await waitForAll([host, known], (player) => player.received("game-started"), {
      label: "late-join game started",
    });

    // Once the "started" flag has reached the database, the join endpoint has
    // everything it needs to turn a newcomer away.
    await waitForSnapshot(slug, (res) => res.body?.roomStatus === "started", {
      label: "start persisted before the late join",
    });

    const strangerId = `qa-stranger-${Date.now()}`;
    const restJoin = await joinSession(slug, {
      participantId: strangerId,
      displayName: "Stranger",
    });
    t.check(
      "late-join-rejected-by-api",
      restJoin.status === 409,
      `status=${restJoin.status} body=${JSON.stringify(restJoin.body)}`,
    );

    const snapshot = await api(`/api/sessions/${slug}`);
    t.check(
      "rejected-late-joiner-not-persisted",
      !(snapshot.body?.participantIds ?? []).includes(strangerId),
      `participantIds=${JSON.stringify(snapshot.body?.participantIds)}`,
    );

    // A stranger opening the room URL straight from a shared link.
    const locked = await new Promise((resolve) => {
      const ws = new WebSocket(
        `${config.wsUrl}?slug=${slug}&participantId=qa-ws-stranger-${Date.now()}&displayName=Stranger`,
        { headers: { "x-forwarded-for": "10.77.0.9" } },
      );
      const seen = [];
      const finish = (closed) => resolve({ seen, closed });
      const timer = setTimeout(() => {
        ws.close();
        finish(false);
      }, 4000);
      ws.on("message", (raw) => {
        try {
          seen.push(JSON.parse(raw.toString()));
        } catch {
          seen.push({ type: "parse-error" });
        }
      });
      ws.on("close", () => {
        clearTimeout(timer);
        finish(true);
      });
      ws.on("error", () => {});
    });
    t.check(
      "late-join-socket-locked-out",
      locked.seen.some((message) => message?.type === "room-locked") &&
        locked.closed,
      `messages=${JSON.stringify(locked.seen.map((m) => m?.type))} closed=${locked.closed}`,
    );

    // Someone who was already in the room keeps their seat.
    const rejoin = await joinSession(slug, {
      participantId: known.participantId,
      displayName: "LateKnown",
      participantToken: known.token,
    });
    t.check(
      "known-player-can-rejoin-after-start",
      rejoin.ok,
      `status=${rejoin.status} body=${JSON.stringify(rejoin.body)}`,
    );
  },
);

scenario(
  "late-join-during-the-start-window",
  {
    covers:
      "A newcomer arriving in the instant the host starts is still turned away",
  },
  async (t) => {
    // The join endpoint reads roomStatus out of Mongo, but the room flips to
    // "started" in the websocket runtime's memory first and is written back
    // asynchronously. A join landing inside that gap is judged against a
    // roomStatus that is already stale.
    const items = makeItems(4, "window");
    const slug = await createSession({ title: "QA Window", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "WindowHost" });
    t.cleanupPlayer(host);
    await host.waitFor((player) => player.hostId() === player.participantId, {
      label: "host ready",
    });

    const strangerId = `qa-window-stranger-${Date.now()}`;
    host.startGame(items);
    const [restJoin] = await Promise.all([
      joinSession(slug, { participantId: strangerId, displayName: "Racer" }),
      host.waitForMessage("game-started", { label: "start broadcast" }),
    ]);

    t.check(
      "start-window-join-rejected",
      restJoin.status === 409,
      `status=${restJoin.status} - the join endpoint gates on the persisted roomStatus, which the runtime writes after it broadcasts game-started, so a stranger is handed a participant token for a game already under way`,
    );

    await sleep(700);
    const snapshot = await api(`/api/sessions/${slug}`);
    // Whether the stranger sticks depends on which write lands last: the
    // join's $addToSet, or the runtime's next snapshot, which rewrites
    // participantIds from memory and drops them. Recorded rather than asserted
    // because it is a coin toss - but when it does stick, a room later rebuilt
    // from this document treats them as a known player.
    t.metric(
      "strangerLeftOnRoster",
      (snapshot.body?.participantIds ?? []).includes(strangerId),
    );

    // Whatever the REST endpoint said, the running room must not let them in.
    const blocked = await Player.enter(slug, {
      name: "Racer",
      participantId: strangerId,
      token: restJoin.body?.participantToken,
    }).catch(() => null);
    if (blocked) t.cleanupPlayer(blocked);

    t.check(
      "start-window-join-cannot-reach-the-live-room",
      !blocked || blocked.received("room-locked") || blocked.closed,
      `messages=${JSON.stringify((blocked?.messages ?? []).map((m) => m.payload?.type))}`,
    );
  },
);

scenario(
  "reconnect-rehydration",
  {
    covers:
      "A dropped player rejoins mid-game and lands back on the live board",
  },
  async (t) => {
    const items = makeItems(4, "drop");
    const slug = await createSession({ title: "QA Reconnect", items });
    t.trackSession(slug);

    let host = await Player.enter(slug, { name: "DropHost" });
    t.cleanupPlayer(host);
    let friend = await Player.enter(slug, { name: "DropFriend" });
    t.cleanupPlayer(friend);

    await waitForAll([host, friend], (player) => player.roster().length === 2, {
      label: "both connected",
    });
    host.startGame(items);
    await waitForAll([host, friend], (player) => player.received("game-started"), {
      label: "reconnect game started",
    });

    host.vote({ round: 0, match: 0, choice: 0 });
    friend.vote({ round: 0, match: 0, choice: 0 });
    await waitForAll(
      [host, friend],
      (player) => player.gameState()?.currentMatch === 1,
      { label: "first match settled" },
    );

    const hostId = host.participantId;
    const hostToken = host.token;
    const friendId = friend.participantId;
    const friendToken = friend.token;

    host.close();
    friend.close();
    await sleep(800);

    const persisted = await waitForSnapshot(
      slug,
      (res) =>
        res.body?.roomStatus === "started" &&
        res.body?.gameState?.currentMatch === 1,
      { label: "mid-game state persisted after everyone drops" },
    );
    t.check(
      "state-survives-an-empty-room",
      persisted.body?.gameState?.round === 0 &&
        persisted.body?.gameState?.currentMatch === 1,
      `round=${persisted.body?.gameState?.round} match=${persisted.body?.gameState?.currentMatch}`,
    );

    // A returning tab reuses its stored participant id and token.
    host = await Player.enter(slug, {
      name: "DropHost",
      participantId: hostId,
      token: hostToken,
    });
    t.cleanupPlayer(host);
    friend = await Player.enter(slug, {
      name: "DropFriend",
      participantId: friendId,
      token: friendToken,
    });
    t.cleanupPlayer(friend);

    await waitForAll(
      [host, friend],
      (player) =>
        player.roomStatus() === "started" &&
        player.gameState()?.currentMatch === 1,
      { label: "both rehydrate onto the live match" },
    );
    t.check(
      "reconnect-lands-on-the-live-match",
      [host, friend].every(
        (player) =>
          player.gameState()?.round === 0 &&
          player.gameState()?.currentMatch === 1,
      ),
      `host=${host.gameState()?.currentMatch} friend=${friend.gameState()?.currentMatch}`,
    );
    t.check(
      "reconnecting-host-keeps-the-role",
      host.hostId() === hostId,
      `host=${host.hostId()} expected=${hostId}`,
    );
    t.check(
      "earlier-results-survive-the-reconnect",
      (host.gameState()?.matchHistory ?? []).some(
        (entry) => entry.winnerItemId === items[0].id,
      ),
      `history=${JSON.stringify((host.gameState()?.matchHistory ?? []).map((e) => e.winnerItemId))}`,
    );

    // Play it out so the room reaches a winner for the rematch checks below.
    host.vote({ round: 0, match: 1, choice: 2 });
    friend.vote({ round: 0, match: 1, choice: 2 });
    await waitForAll([host, friend], (player) => player.gameState()?.round === 1, {
      label: "round 1 reached",
    });
    host.vote({ round: 1, match: 0, choice: 0 });
    friend.vote({ round: 1, match: 0, choice: 0 });
    await waitForAll(
      [host, friend],
      (player) => player.roomStatus() === "completed",
      { label: "game completed" },
    );
    t.check(
      "winner-agreed-after-a-reconnect",
      host.gameState()?.winner?.id === items[0].id &&
        friend.gameState()?.winner?.id === items[0].id,
      `host=${host.gameState()?.winner?.id} friend=${friend.gameState()?.winner?.id}`,
    );

    // --- play again --------------------------------------------------------
    friend.startGame(items);
    await friend.waitForMessage("start-denied", {
      label: "guest rematch denied",
      timeout: 5000,
    });
    t.check(
      "only-the-host-can-restart",
      friend.received("start-denied") && host.roomStatus() === "completed",
      `denied=${friend.received("start-denied")} status=${host.roomStatus()}`,
    );

    host.startGame(items);
    await waitForAll(
      [host, friend],
      (player) =>
        player.roomStatus() === "started" && player.gameState()?.round === 0,
      { label: "rematch reaches both clients" },
    );
    t.check(
      "play-again-replays-the-same-bracket",
      JSON.stringify(
        (host.gameState()?.currentRoundItems ?? []).map((item) => item.id),
      ) === JSON.stringify(items.map((item) => item.id)),
      `items=${JSON.stringify((host.gameState()?.currentRoundItems ?? []).map((i) => i.id))}`,
    );
    t.check(
      "play-again-clears-the-old-winner",
      !host.gameState()?.winner &&
        (host.gameState()?.matchHistory ?? []).length === 0,
      `winner=${JSON.stringify(host.gameState()?.winner)} history=${(host.gameState()?.matchHistory ?? []).length}`,
    );
  },
);

scenario(
  "host-handoff",
  {
    covers: "The room is not stranded when the host disappears",
    slow: true,
  },
  async (t) => {
    const graceMs = Number(process.env.QA_HOST_HANDOFF_GRACE_MS || 15000);
    const items = makeItems(4, "handoff");
    const slug = await createSession({ title: "QA Handoff", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "GoneHost" });
    t.cleanupPlayer(host);
    const second = await Player.enter(slug, { name: "SecondUp" });
    t.cleanupPlayer(second);
    const third = await Player.enter(slug, { name: "ThirdUp" });
    t.cleanupPlayer(third);

    await waitForAll([host, second, third], (p) => p.roster().length === 3, {
      label: "three in the handoff room",
    });
    t.check(
      "first-player-in-is-the-host",
      second.hostId() === host.participantId,
      `host=${second.hostId()} expected=${host.participantId}`,
    );

    host.close();
    t.metric("hostHandoffGraceMs", graceMs);
    await sleep(graceMs + 2500);

    t.check(
      "host-passes-to-the-earliest-remaining-player",
      second.hostId() === second.participantId &&
        third.hostId() === second.participantId,
      `second sees ${second.hostId()}, third sees ${third.hostId()}, expected ${second.participantId}`,
    );

    second.startGame(items);
    await waitForAll([second, third], (player) => player.received("game-started"), {
      label: "new host can start the game",
      timeout: 8000,
    });
    t.check(
      "new-host-can-start-the-game",
      [second, third].every((player) => player.roomStatus() === "started"),
      `statuses=${[second, third].map((p) => p.roomStatus()).join(",")}`,
    );
  },
);

scenario(
  "identity-and-auth",
  {
    covers:
      "A socket that has not proved who it is cannot vote or start, and a player slot cannot be stolen",
  },
  async (t) => {
    const items = makeItems(4, "auth");
    const slug = await createSession({ title: "QA Auth", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "AuthHost" });
    t.cleanupPlayer(host);

    // Connected and watching, but never sent a valid "auth".
    const lurker = await Player.enter(slug, {
      name: "Lurker",
      skipAuth: true,
    });
    t.cleanupPlayer(lurker);

    lurker.startGame(items);
    await lurker.waitForMessage("start-denied", {
      label: "unverified socket start denied",
      timeout: 5000,
    });
    t.check(
      "unverified-socket-cannot-start",
      lurker.received("start-denied") && host.roomStatus() === "waiting",
      `denied=${lurker.received("start-denied")} status=${host.roomStatus()}`,
    );

    host.startGame(items);
    await host.waitForMessage("game-started", { label: "auth game started" });
    t.check(
      "unverified-socket-not-counted-in-quorum",
      host.gameState()?.requiredVoteCount === 1,
      `required=${host.gameState()?.requiredVoteCount}`,
    );

    lurker.vote({ round: 0, match: 0, choice: 1 });
    await sleep(600);
    t.check(
      "unverified-socket-vote-ignored",
      host.gameState()?.pendingVoteCount === 0 &&
        host.gameState()?.currentMatch === 0,
      `pending=${host.gameState()?.pendingVoteCount} match=${host.gameState()?.currentMatch}`,
    );

    const badToken = await new Promise((resolve) => {
      const player = new Player({
        slug,
        participantId: host.participantId,
        displayName: "Impostor",
        ip: "10.66.0.4",
      });
      player
        .connect()
        .then(() => {
          player.send({
            type: "auth",
            participantId: host.participantId,
            participantToken: "0".repeat(64),
          });
          return player.waitForMessage("auth-denied", {
            timeout: 6000,
            label: "auth-denied",
          });
        })
        .then(() => {
          player.close();
          resolve(true);
        })
        .catch(() => {
          player.close();
          resolve(false);
        });
    });
    t.check(
      "wrong-token-is-refused-on-the-socket",
      badToken,
      "socket presenting a forged token was not sent auth-denied",
    );

    // Taking over someone else's slot through the join endpoint.
    const steal = await joinSession(slug, {
      participantId: host.participantId,
      displayName: "Impostor",
      participantToken: "not-the-real-token",
    });
    t.check(
      "player-slot-cannot-be-claimed-without-the-token",
      steal.status === 403,
      `status=${steal.status} body=${JSON.stringify(steal.body)}`,
    );

    // And the real owner still gets in with theirs.
    const owner = await joinSession(slug, {
      participantId: host.participantId,
      displayName: "AuthHost",
      participantToken: host.token,
    });
    t.check(
      "owner-still-holds-their-slot",
      owner.ok && owner.body?.participantToken === host.token,
      `status=${owner.status}`,
    );
  },
);

scenario(
  "rate-limits",
  { covers: "One device cannot hammer room creation or joins" },
  async (t) => {
    const ip = "10.55.55.55";
    const items = makeItems(4, "limit");

    let limited = null;
    for (let attempt = 0; attempt < 14 && !limited; attempt += 1) {
      const res = await api("/api/sessions", {
        method: "POST",
        body: { title: `QA Limit ${attempt}`, items },
        ip,
      });
      if (res.body?.slug) t.trackSession(res.body.slug);
      if (res.status === 429) limited = res;
    }

    t.check(
      "room-creation-is-rate-limited",
      Boolean(limited),
      "14 room creations from one address were all accepted",
    );
    t.check(
      "rate-limit-tells-the-client-when-to-retry",
      Number(limited?.retryAfter) > 0,
      `retryAfter=${limited?.retryAfter}`,
    );
  },
);
