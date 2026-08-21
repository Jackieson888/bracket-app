// The two clocks the room runs on: the per-match vote deadline, and the TTL
// that eventually retires the room entirely.
import WebSocket from "ws";
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
} from "../lib/harness.mjs";

scenario(
  "match-deadline-settles-a-stalled-match",
  {
    covers:
      "An idle player cannot hold the room forever - the match deadline settles it",
    slow: true,
  },
  async (t) => {
    const items = makeItems(4, "clock");
    const slug = await createSession({ title: "QA Clock", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "ClockHost" });
    t.cleanupPlayer(host);
    const idle = await Player.enter(slug, { name: "ClockIdle" });
    t.cleanupPlayer(idle);
    const both = [host, idle];

    await waitForAll(both, (player) => player.roster().length === 2, {
      label: "both connected",
    });
    host.startGame(items);
    await waitForAll(both, (player) => player.received("game-started"), {
      label: "clock game started",
    });

    const deadline = Number(host.gameState()?.matchDeadline);
    t.check(
      "deadline-published-to-clients",
      Number.isFinite(deadline) && deadline > Date.now(),
      `matchDeadline=${host.gameState()?.matchDeadline}`,
    );
    t.metric("matchWindowMs", deadline - Date.now());

    // Only one of the two votes. The quorum is never met, so the only thing
    // that can move the board is the deadline.
    host.vote({ round: 0, match: 0, choice: 0 });
    await waitForAll(
      both,
      (player) => player.gameState()?.pendingVoteCount === 1,
      { label: "one vote in" },
    );
    t.check(
      "match-stays-open-before-the-deadline",
      both.every((player) => player.gameState()?.currentMatch === 0),
      `matches=${both.map((p) => p.gameState()?.currentMatch).join(",")}`,
    );

    // Fall back to the runtime's own ceiling if no deadline was published, so
    // a missing field fails on the assertion above rather than by timing out
    // against a NaN budget.
    const waitMs = Number.isFinite(deadline)
      ? Math.max(0, deadline - Date.now()) + 4000
      : 45000;
    await waitForAll(
      both,
      (player) => player.gameState()?.currentMatch === 1,
      { label: "deadline settles the match", timeout: waitMs },
    );
    t.check(
      "deadline-settles-with-the-votes-cast",
      both.every(
        (player) => player.gameState()?.lastWinner?.id === items[0].id,
      ),
      `winners=${both.map((p) => p.gameState()?.lastWinner?.id).join(",")} expected=${items[0].id}`,
    );
    t.check(
      "next-match-gets-its-own-deadline",
      Number(host.gameState()?.matchDeadline) > Date.now(),
      `matchDeadline=${host.gameState()?.matchDeadline}`,
    );
  },
);

scenario(
  "expired-room-is-retired",
  { covers: "A room past its expiry stops admitting anyone" },
  async (t) => {
    const items = makeItems(4, "stale");
    const slug = await createSession({ title: "QA Stale", items });
    t.trackSession(slug);

    if (!t.mongo) {
      t.skip("expired-room-is-retired", "needs Mongo to age the room");
      return;
    }

    // Age the room rather than waiting out the 30 minute TTL.
    await t.mongo
      .db("prod")
      .collection("sessions")
      .updateOne(
        { slug },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } },
      );

    const lookup = await api(`/api/sessions/${slug}`);
    t.check(
      "expired-room-lookup-404s",
      lookup.status === 404,
      `status=${lookup.status} body=${JSON.stringify(lookup.body)}`,
    );

    // The lookup deletes the expired document, so a join now finds nothing.
    const join = await joinSession(slug, {
      participantId: `qa-stale-${Date.now()}`,
      displayName: "TooLate",
    });
    t.check(
      "expired-room-refuses-joins",
      join.status === 404,
      `status=${join.status} body=${JSON.stringify(join.body)}`,
    );

    const staleSocketId = `qa-stale-ws-${Date.now()}`;
    const socket = await new Promise((resolve) => {
      const ws = new WebSocket(
        `${config.wsUrl}?slug=${slug}&participantId=${staleSocketId}&displayName=TooLate`,
        { headers: { "x-forwarded-for": "10.88.0.3" } },
      );
      const seen = [];
      const timer = setTimeout(() => {
        ws.close();
        resolve({ seen, closed: false });
      }, 5000);
      ws.on("message", (raw) => {
        try {
          seen.push(JSON.parse(raw.toString()));
        } catch {
          seen.push({ type: "parse-error" });
        }
      });
      ws.on("close", () => {
        clearTimeout(timer);
        resolve({ seen, closed: true });
      });
      ws.on("error", () => {});
    });

    const served = socket.seen.find((message) => message?.type === "room-state");

    // Whatever the socket does, the retired room's contents must not come
    // back: no former players, no bracket, no result. The connecting socket
    // itself is always in the roster it is sent.
    t.check(
      "expired-room-does-not-serve-its-old-state",
      !served ||
        ((served.clients ?? []).every(
          (client) => client.id === staleSocketId,
        ) &&
          (served.gameState?.currentRoundItems ?? []).length === 0 &&
          !served.gameState?.winner &&
          served.roomStatus === "waiting"),
      `room-state=${JSON.stringify(served)}`,
    );

    // The lookup deleted the session document, so there is no such room any
    // more. The runtime builds a fresh one for the code regardless, which is
    // how an expired or simply invented room code still gets a live socket and
    // an empty lobby instead of "this room is gone".
    t.check(
      "expired-room-socket-is-turned-away",
      socket.closed && !served,
      `messages=${JSON.stringify(socket.seen.map((m) => m?.type))} closed=${socket.closed} - getOrCreateRoom builds a room for any slug once loadPersistedRoom comes back empty, so an unknown code is indistinguishable from a new one`,
    );

    await sleep(200);
  },
);
