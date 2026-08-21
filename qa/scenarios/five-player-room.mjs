// A full room, played the way a group actually plays it.
//
// The scenarios either side of this one prove the pieces work; this one is
// about what a group of friends experiences, and it exists because all three
// of its guarantees were broken in a real game:
//
//   1. The person who made the room is the host. It used to be whoever's
//      socket finished verifying first, which is a race the creator regularly
//      lost - watching someone else hold the start button in their own room.
//   2. Every player's vote counts, on every match. The quorum only ever
//      counted verified sockets, so a player the room had not verified was
//      silently voting into a void while everyone else decided the bracket.
//   3. Nobody's vote is lost to a slow start. The vote window used to open on
//      a server-side guess at how long the intro takes, so a phone that was
//      still buffering could arrive after the match had already been settled.
//      The window now waits for every board to report in.
import {
  api,
  createRoom,
  createSession,
  makeItems,
  Player,
  scenario,
  waitForSnapshot,
} from "../lib/harness.mjs";

const PLAYER_COUNT = 5;

// Must match the server's READY_GRACE_MS. Start the server with a short one to
// keep the fallback scenario quick - see qa/README.md.
const READY_GRACE_MS = Number(process.env.QA_READY_GRACE_MS || 20000);

scenario(
  "five-player-room",
  {
    covers:
      "Five players in one room: the creator hosts, the countdown waits for every board, and all five votes decide every match",
  },
  async (t) => {
    // Eight items is three rounds - four matches, then two, then the final -
    // so the barrier and the vote tally are exercised across round boundaries
    // and not just on the opening match.
    const items = makeItems(8, "five");
    const { slug, hostClaimToken } = await createRoom({
      title: `QA Five ${Date.now()}`,
      items,
    });
    t.trackSession(slug);

    t.check(
      "room-creation-returns-a-host-claim",
      typeof hostClaimToken === "string" && hostClaimToken.length >= 32,
      `hostClaimToken=${hostClaimToken ? `${hostClaimToken.slice(0, 8)}...` : hostClaimToken}`,
    );

    // Nobody's board reports itself: this scenario drives readiness by hand so
    // it can watch the barrier hold.
    const players = [];

    // The four guests get in first, and one of them verifies before the
    // creator is anywhere near the room. Under the old first-to-verify rule
    // that made a guest the host.
    for (let index = 1; index < PLAYER_COUNT; index += 1) {
      players.push(
        await Player.enter(slug, { name: `Guest ${index}`, autoReady: false }),
      );
    }

    const creator = await Player.enter(slug, {
      name: "Creator",
      hostClaimToken,
      autoReady: false,
    });
    players.unshift(creator);
    players.forEach((player) => t.cleanupPlayer(player));

    await creator.waitFor(
      (player) => player.hostId() === creator.participantId,
      { label: "creator holds the host role" },
    );

    t.check(
      "creator-is-host-even-though-guests-arrived-first",
      creator.hostId() === creator.participantId,
      `host=${creator.hostId()} creator=${creator.participantId} guests=${players
        .slice(1)
        .map((player) => player.participantId)
        .join(",")}`,
    );

    // Every player agrees who the host is - the role is room state, not a
    // local guess, so a guest's board must not offer them the start button.
    await players[1].waitFor(
      (player) => player.hostId() === creator.participantId,
      { label: "guests see the creator as host" },
    );
    t.check(
      "every-client-agrees-on-the-host",
      players.every((player) => player.hostId() === creator.participantId),
      `hosts=${JSON.stringify(players.map((player) => player.hostId()))}`,
    );

    // A guest cannot start the room they did not make.
    players[1].startGame(items);
    await players[1].waitForMessage("start-denied", {
      label: "guest start refused",
    });
    t.check(
      "guests-cannot-start-the-game",
      players[1].roomStatus() !== "started",
      `roomStatus=${players[1].roomStatus()}`,
    );

    creator.startGame(items);
    await Promise.all(
      players.map((player) =>
        player.waitForMessage("game-started", {
          label: `${player.displayName} sees game-started`,
        }),
      ),
    );

    t.check(
      "quorum-is-every-player-in-the-room",
      creator.gameState()?.requiredVoteCount === PLAYER_COUNT,
      `requiredVoteCount=${creator.gameState()?.requiredVoteCount}`,
    );

    // --- the readiness barrier ---------------------------------------------
    // Four boards up, one still on the intro. The countdown must not have
    // started: whatever is happening on that fifth phone, its owner has not
    // been shown anything to vote on yet.
    for (const player of players.slice(0, PLAYER_COUNT - 1)) {
      player.ready({ round: 0, match: 0 });
    }

    await creator.waitFor(
      (player) => player.gameState()?.readyParticipantCount === PLAYER_COUNT - 1,
      { label: "four boards reported ready" },
    );

    t.check(
      "countdown-waits-for-the-last-board",
      creator.gameState()?.awaitingPlayers === true &&
        !creator.gameState()?.matchDeadline,
      `awaitingPlayers=${creator.gameState()?.awaitingPlayers} matchDeadline=${creator.gameState()?.matchDeadline}`,
    );
    t.check(
      "board-reports-who-it-is-waiting-for",
      creator.gameState()?.readyParticipantCount === PLAYER_COUNT - 1 &&
        creator.gameState()?.requiredReadyCount === PLAYER_COUNT,
      `ready=${creator.gameState()?.readyParticipantCount}/${creator.gameState()?.requiredReadyCount}`,
    );

    players[PLAYER_COUNT - 1].ready({ round: 0, match: 0 });

    await creator.waitFor(
      (player) => Number(player.gameState()?.matchDeadline) > Date.now(),
      { label: "countdown starts once every board is up" },
    );
    t.check(
      "countdown-starts-when-the-last-board-arrives",
      Number(creator.gameState()?.matchDeadline) > Date.now() &&
        creator.gameState()?.awaitingPlayers === false,
      `matchDeadline=${creator.gameState()?.matchDeadline} awaitingPlayers=${creator.gameState()?.awaitingPlayers}`,
    );

    // Every client is counting down to the same instant - a per-client window
    // would give whoever loaded last less time to vote.
    const deadlines = players.map((player) =>
      Number(player.gameState()?.matchDeadline),
    );
    t.check(
      "every-client-counts-down-to-the-same-deadline",
      deadlines.every((deadline) => deadline === deadlines[0]),
      `deadlines=${JSON.stringify(deadlines)}`,
    );

    // --- playing it out -----------------------------------------------------
    // Every player votes on every match, and the winner of each is the item
    // the majority actually picked. Guests 1 and 2 vote against the creator's
    // pick each time, so a 3-2 split decides every match and a tally that
    // quietly dropped anybody's vote would land on the wrong item.
    const settled = [];
    let guard = 0;

    while (creator.roomStatus() === "started" && guard < 12) {
      guard += 1;
      const state = creator.gameState();
      const round = state?.round ?? 0;
      const match = state?.currentMatch ?? 0;
      const roundItems = state?.currentRoundItems ?? [];
      const startIndex = match * (state?.matchSize ?? 2);
      const left = roundItems[startIndex];
      const right = roundItems[startIndex + 1];

      if (!right) {
        // A bye - nothing to vote on. Wait for the room to carry it forward.
        await creator.waitFor(
          (player) =>
            (player.gameState()?.round ?? 0) !== round ||
            (player.gameState()?.currentMatch ?? 0) !== match ||
            player.roomStatus() !== "started",
          { label: `bye at ${round}:${match} advances` },
        );
        continue;
      }

      // Wait for the window to open before anybody votes: this is the
      // guarantee being tested, so voting into a closed one would hide it.
      await creator.waitFor(
        (player) => Number(player.gameState()?.matchDeadline) > Date.now(),
        { label: `countdown open for ${round}:${match}` },
      );

      // Three for the left contender, two for the right.
      players.forEach((player, index) => {
        player.vote({
          round,
          match,
          choice: index < 3 ? startIndex : startIndex + 1,
        });
      });

      settled.push({ round, match, expectedWinnerId: left.id });

      await creator.waitFor(
        (player) =>
          (player.gameState()?.round ?? 0) !== round ||
          (player.gameState()?.currentMatch ?? 0) !== match ||
          player.roomStatus() !== "started",
        { label: `match ${round}:${match} settles`, timeout: 15000 },
      );

      // The next matchup re-closes the barrier, so report every board again.
      const next = creator.gameState();
      if (creator.roomStatus() === "started" && next) {
        players.forEach((player) =>
          player.ready({
            round: next.round ?? 0,
            match: next.currentMatch ?? 0,
          }),
        );
      }
    }

    t.check(
      "game-reaches-a-winner",
      creator.roomStatus() === "completed",
      `roomStatus=${creator.roomStatus()} guard=${guard}`,
    );

    // --- every vote landed --------------------------------------------------
    const history = creator.gameState()?.matchHistory ?? [];
    const contested = history.filter((entry) => !entry.wasBye);

    t.check(
      "every-contested-match-counted-all-five-votes",
      contested.length > 0 &&
        contested.every(
          (entry) =>
            Object.values(entry.voteCounts ?? {}).reduce((a, b) => a + b, 0) ===
            PLAYER_COUNT,
        ),
      JSON.stringify(
        contested.map((entry) => ({
          match: `${entry.round}:${entry.match}`,
          counts: entry.voteCounts,
        })),
      ),
    );

    t.check(
      "every-player-appears-in-every-match-they-voted-on",
      contested.every(
        (entry) =>
          new Set((entry.votes ?? []).map((vote) => vote.participantId)).size ===
          PLAYER_COUNT,
      ),
      JSON.stringify(
        contested.map((entry) => (entry.votes ?? []).length),
      ),
    );

    // The majority pick won every time, which is only true if all five votes
    // were tallied - three against two flips to the wrong item if one is lost.
    const majorityRespected = settled.every((expected) => {
      const entry = contested.find(
        (candidate) =>
          candidate.round === expected.round &&
          candidate.match === expected.match,
      );
      return entry?.winnerItemId === expected.expectedWinnerId;
    });
    t.check(
      "the-majority-pick-won-every-match",
      settled.length > 0 && majorityRespected,
      JSON.stringify(
        settled.map((expected) => ({
          match: `${expected.round}:${expected.match}`,
          expected: expected.expectedWinnerId,
          actual: contested.find(
            (candidate) =>
              candidate.round === expected.round &&
              candidate.match === expected.match,
          )?.winnerItemId,
        })),
      ),
    );

    const snapshot = await waitForSnapshot(
      slug,
      (res) => res.body?.roomStatus === "completed",
      { label: "five-player result persisted" },
    );
    t.check(
      "result-persisted-with-the-same-winner",
      snapshot.body?.gameState?.winner?.id ===
        creator.gameState()?.winner?.id,
      `persisted=${snapshot.body?.gameState?.winner?.id} live=${creator.gameState()?.winner?.id}`,
    );

    // The claim that makes someone the host must never be readable from the
    // room, or the role is takeable by anyone who knows the code.
    const publicRoom = await api(`/api/sessions/${slug}`);
    t.check(
      "host-claim-is-never-served-to-clients",
      !("hostClaimToken" in (publicRoom.body ?? {})),
      `keys=${Object.keys(publicRoom.body ?? {}).join(",")}`,
    );
  },
);

// The barrier's safety valve. Waiting for every board is right up until a
// board never arrives - a phone that locked, a tab that was closed mid-intro,
// a client wedged on a video that will not load. The room has to start
// anyway, or one person's dead battery ends the game for everyone.
scenario(
  "readiness-barrier-cannot-stall-the-room",
  {
    covers:
      "A player whose board never reports in delays the vote window but does not hold it shut",
    slow: true,
  },
  async (t) => {
    const items = makeItems(4, "stall");
    const slug = await createSession({ title: "QA Stall", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "StallHost", autoReady: false });
    t.cleanupPlayer(host);
    const ghost = await Player.enter(slug, { name: "StallGhost", autoReady: false });
    t.cleanupPlayer(ghost);

    await host.waitFor((player) => player.roster().length === 2, {
      label: "both players connected",
    });

    host.startGame(items);
    await host.waitForMessage("game-started", { label: "stall game started" });

    // One board up, one that will never report.
    host.ready({ round: 0, match: 0 });
    await host.waitFor(
      (player) => player.gameState()?.readyParticipantCount === 1,
      { label: "one board ready" },
    );

    t.check(
      "window-is-held-while-a-board-is-missing",
      host.gameState()?.awaitingPlayers === true &&
        !host.gameState()?.matchDeadline,
      `awaitingPlayers=${host.gameState()?.awaitingPlayers} matchDeadline=${host.gameState()?.matchDeadline}`,
    );

    // The fallback has to outlast the intro it is covering for, so allow the
    // server's estimate on top of the grace itself.
    await host.waitFor(
      (player) => Number(player.gameState()?.matchDeadline) > Date.now(),
      {
        label: "window opens anyway",
        timeout: READY_GRACE_MS + 20000,
      },
    );

    t.check(
      "window-opens-without-the-missing-board",
      Number(host.gameState()?.matchDeadline) > Date.now() &&
        host.gameState()?.awaitingPlayers === false,
      `matchDeadline=${host.gameState()?.matchDeadline} ready=${host.gameState()?.readyParticipantCount}/${host.gameState()?.requiredReadyCount}`,
    );

    // And the player who never reported can still vote - readiness gates the
    // clock, never the ballot.
    host.vote({ round: 0, match: 0, choice: 0 });
    ghost.vote({ round: 0, match: 0, choice: 0 });
    await host.waitFor(
      (player) => (player.gameState()?.currentMatch ?? 0) === 1,
      { label: "match settles on both votes" },
    );
    t.check(
      "a-player-who-never-reported-can-still-vote",
      (host.gameState()?.matchHistory ?? []).some(
        (entry) =>
          entry.round === 0 &&
          entry.match === 0 &&
          Object.values(entry.voteCounts ?? {}).reduce((a, b) => a + b, 0) === 2,
      ),
      JSON.stringify(host.gameState()?.matchHistory?.[0]?.voteCounts),
    );
  },
);
