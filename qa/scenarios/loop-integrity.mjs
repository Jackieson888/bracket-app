// Things that go wrong to a game already in progress, rather than to one
// being set up. Both scenarios here are regressions for bugs found by playing
// games against the real runtime and watching what the room did afterwards.
import {
  api,
  createRoom,
  makeItems,
  Player,
  scenario,
  sleep,
} from "../lib/harness.mjs";

// Rooms are evicted from memory once they have been empty for this long, and
// rebuilt from Mongo when someone comes back. The default is five minutes,
// which is far too long to sit through, so the eviction scenario only runs
// when the server has been started with a short one - see qa/README.md.
const ROOM_IDLE_TTL_MS = Number(process.env.QA_ROOM_IDLE_TTL_MS || 0);

// Plays a bracket to completion with two players voting together.
async function playToCompletion(host, others, { timeout = 20000 } = {}) {
  const everyone = [host, ...others];
  let guard = 0;

  while (host.roomStatus() === "started" && guard < 20) {
    guard += 1;
    const state = host.gameState();
    const round = state?.round ?? 0;
    const match = state?.currentMatch ?? 0;
    const key = `${round}:${match}`;
    const startIndex = match * (state?.matchSize ?? 2);

    await host
      .waitFor((player) => Number(player.gameState()?.matchDeadline) > Date.now(), {
        label: `window opens for ${key}`,
        timeout,
      })
      .catch(() => {});

    everyone.forEach((player) =>
      player.vote({ round, match, choice: startIndex }),
    );

    await host.waitFor(
      (player) =>
        `${player.gameState()?.round}:${player.gameState()?.currentMatch}` !==
          key || player.roomStatus() !== "started",
      { label: `match ${key} settles`, timeout },
    );
  }

  return guard;
}

scenario(
  "a-finished-game-stays-finished",
  {
    covers:
      "A vote that lands after the bracket is decided is refused instead of being tallied against it",
  },
  async (t) => {
    const items = makeItems(4, "late");
    const { slug, hostClaimToken } = await createRoom({
      title: `QA Late ${Date.now()}`,
      items,
    });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "LateHost", hostClaimToken });
    t.cleanupPlayer(host);
    const other = await Player.enter(slug, { name: "LateOther" });
    t.cleanupPlayer(other);
    await host.waitFor((player) => player.roster().length === 2, {
      label: "both connected",
    });

    host.startGame(items);
    await host.waitForMessage("game-started", { label: "late game started" });
    await playToCompletion(host, [other]);

    t.check(
      "game-completed",
      host.roomStatus() === "completed",
      `roomStatus=${host.roomStatus()}`,
    );

    const before = host.gameState();
    const historyBefore = (before?.matchHistory ?? []).length;
    const winnerBefore = before?.winner?.id;

    // A vote arriving after the final whistle: a queued vote flushed on
    // reconnect, or a double tap as the last match settled. It used to be
    // tallied against the completed bracket, appending a phantom match in
    // which the winner beat itself - persisted, and credited to the winner in
    // every stat derived from the match log.
    const finalRound = before?.round ?? 0;
    other.vote({ round: finalRound, match: 0, choice: 0 });
    host.vote({ round: finalRound, match: 0, choice: 1 });
    await sleep(1500);

    const after = host.gameState();

    t.check(
      "late-vote-does-not-append-a-phantom-match",
      (after?.matchHistory ?? []).length === historyBefore,
      `before=${historyBefore} after=${(after?.matchHistory ?? []).length} added=${JSON.stringify(
        (after?.matchHistory ?? []).slice(historyBefore),
      )}`,
    );
    t.check(
      "late-vote-does-not-change-the-winner",
      after?.winner?.id === winnerBefore,
      `before=${winnerBefore} after=${after?.winner?.id}`,
    );
    t.check(
      "late-vote-does-not-reopen-the-room",
      host.roomStatus() === "completed",
      `roomStatus=${host.roomStatus()}`,
    );

    const snapshot = await api(`/api/sessions/${slug}`);
    t.check(
      "the-persisted-match-log-is-not-corrupted",
      (snapshot.body?.gameState?.matchHistory ?? []).length === historyBefore,
      `persisted=${(snapshot.body?.gameState?.matchHistory ?? []).length} expected=${historyBefore}`,
    );
  },
);

scenario(
  "a-resumed-room-gets-its-clock-back",
  {
    covers:
      "A room rebuilt from the database - evicted while empty, or the runtime restarted - can still settle its live match",
    slow: true,
  },
  async (t) => {
    if (!ROOM_IDLE_TTL_MS) {
      t.skip(
        "a-resumed-room-gets-its-clock-back",
        "needs the server started with a short ROOM_IDLE_TTL_MS (see qa/README.md)",
      );
      return;
    }

    const items = makeItems(4, "resume");
    const { slug, hostClaimToken } = await createRoom({
      title: `QA Resume ${Date.now()}`,
      items,
    });
    t.trackSession(slug);

    const first = await Player.enter(slug, { name: "ResumeHost", hostClaimToken });
    const second = await Player.enter(slug, { name: "ResumeOther" });
    await first.waitFor((player) => player.roster().length === 2, {
      label: "both connected",
    });

    first.startGame(items);
    await first.waitForMessage("game-started", { label: "resume game started" });
    await first.waitFor(
      (player) => Number(player.gameState()?.matchDeadline) > Date.now(),
      { label: "window opens before the room empties" },
    );
    const deadlineBefore = Number(first.gameState()?.matchDeadline);

    const identities = [first, second].map((player) => ({
      participantId: player.participantId,
      token: player.token,
      displayName: player.displayName,
    }));

    // Everybody walks away mid-match. Once the room has been empty for the
    // idle TTL it is dropped from memory, taking its timers with it - the
    // same state a deploy leaves every in-progress room in.
    first.ws?.close();
    second.ws?.close();
    await sleep(ROOM_IDLE_TTL_MS + 2000);

    const host = await Player.enter(slug, {
      name: identities[0].displayName,
      participantId: identities[0].participantId,
      token: identities[0].token,
      hostClaimToken,
    });
    t.cleanupPlayer(host);
    const other = await Player.enter(slug, {
      name: identities[1].displayName,
      participantId: identities[1].participantId,
      token: identities[1].token,
    });
    t.cleanupPlayer(other);

    await host.waitFor((player) => player.roster().length === 2, {
      label: "both back in the rebuilt room",
      timeout: 10000,
    });

    t.check(
      "the-match-is-where-they-left-it",
      host.roomStatus() === "started" &&
        (host.gameState()?.currentRoundItems ?? []).length === items.length,
      `roomStatus=${host.roomStatus()} items=${(host.gameState()?.currentRoundItems ?? []).length}`,
    );

    // The persisted deadline is in the past and nothing in this process is
    // counting down to it, so the room has to publish a fresh one. Without
    // that the match hangs until every remaining player votes - and if one of
    // them never comes back, forever.
    await host.waitFor(
      (player) => Number(player.gameState()?.matchDeadline) > Date.now(),
      { label: "resumed match is given a live deadline", timeout: 25000 },
    );

    t.check(
      "resumed-match-is-given-a-fresh-deadline",
      Number(host.gameState()?.matchDeadline) > Date.now() &&
        Number(host.gameState()?.matchDeadline) > deadlineBefore,
      `before=${deadlineBefore} after=${host.gameState()?.matchDeadline} now=${Date.now()}`,
    );

    // And it actually fires: one player votes, the other never does.
    const state = host.gameState();
    const round = state?.round ?? 0;
    const match = state?.currentMatch ?? 0;
    host.vote({ round, match, choice: match * (state?.matchSize ?? 2) });

    await host.waitFor(
      (player) =>
        (player.gameState()?.currentMatch ?? 0) !== match ||
        (player.gameState()?.round ?? 0) !== round ||
        player.roomStatus() !== "started",
      {
        label: "resumed match settles on its own",
        timeout: Number(process.env.QA_VOTE_WINDOW_MS || 30000) + 25000,
      },
    );

    t.check(
      "a-resumed-match-still-force-settles",
      (host.gameState()?.currentMatch ?? 0) !== match ||
        (host.gameState()?.round ?? 0) !== round ||
        host.roomStatus() !== "started",
      `match=${host.gameState()?.round}:${host.gameState()?.currentMatch} status=${host.roomStatus()}`,
    );
  },
);
