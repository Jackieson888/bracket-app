// The main event: a waiting room several people join, a host who starts it,
// votes that arrive whenever each player gets around to them, and a board that
// stays identical on every screen.
import {
  createSession,
  makeItems,
  Player,
  playersAreInSync,
  scenario,
  sleep,
  syncDigest,
  waitForAll,
} from "../lib/harness.mjs";

scenario(
  "waiting-room-and-async-voting",
  {
    covers:
      "A waiting room several users join, host-only start, votes cast asynchronously, and live sync across every client",
  },
  async (t) => {
    const items = makeItems(4, "party");
    const slug = await createSession({ title: "QA Party", items });
    t.trackSession(slug);

    // The host is whoever authenticates first, so enter sequentially.
    const host = await Player.enter(slug, { name: "Host" });
    t.cleanupPlayer(host);
    const guests = [];
    for (const name of ["Ana", "Ben", "Cass"]) {
      const guest = await Player.enter(slug, { name });
      t.cleanupPlayer(guest);
      guests.push(guest);
    }
    const everyone = [host, ...guests];
    const expectedRoster = everyone.map((player) => player.participantId).sort();

    // --- waiting room ------------------------------------------------------
    await waitForAll(
      everyone,
      (player) =>
        JSON.stringify(player.roster()) === JSON.stringify(expectedRoster),
      { label: "every client sees the full roster", timeout: 10000 },
    );
    t.check(
      "lobby-roster-visible-to-all",
      everyone.every(
        (player) =>
          JSON.stringify(player.roster()) === JSON.stringify(expectedRoster),
      ),
      everyone
        .map((p) => `${p.displayName}=${p.roster().length}`)
        .join(" "),
    );
    t.check(
      "lobby-stays-in-waiting-until-started",
      everyone.every((player) => player.roomStatus() === "waiting"),
      everyone.map((p) => `${p.displayName}=${p.roomStatus()}`).join(" "),
    );
    t.check(
      "lobby-agrees-on-host",
      everyone.every((player) => player.hostId() === host.participantId),
      everyone.map((p) => `${p.displayName}=${p.hostId()}`).join(" "),
    );

    // --- only the host may start ------------------------------------------
    guests[0].startGame(items);
    await guests[0].waitForMessage("start-denied", {
      label: "guest start denied",
      timeout: 5000,
    });
    t.check(
      "non-host-cannot-start",
      guests[0].received("start-denied") &&
        everyone.every((player) => player.roomStatus() === "waiting"),
      `denied=${guests[0].received("start-denied")} statuses=${everyone.map((p) => p.roomStatus()).join(",")}`,
    );

    host.startGame(items);
    await waitForAll(everyone, (player) => player.received("game-started"), {
      label: "game-started reaches everyone",
    });
    t.check(
      "host-start-reaches-every-client",
      everyone.every((player) => player.roomStatus() === "started"),
      everyone.map((p) => `${p.displayName}=${p.roomStatus()}`).join(" "),
    );
    t.check(
      "quorum-is-every-connected-player",
      everyone.every((player) => player.gameState()?.requiredVoteCount === 4),
      everyone
        .map((p) => `${p.displayName}=${p.gameState()?.requiredVoteCount}`)
        .join(" "),
    );

    // --- asynchronous voting ----------------------------------------------
    // Votes trickle in. The match must not resolve until the last one lands,
    // and every client must watch the counter climb in real time.
    const pendingSeen = [];

    host.vote({ round: 0, match: 0, choice: 0 });
    await waitForAll(
      everyone,
      (player) => player.gameState()?.pendingVoteCount === 1,
      { label: "first vote visible to all" },
    );
    pendingSeen.push(1);
    t.check(
      "first-vote-does-not-resolve-match",
      everyone.every((player) => player.gameState()?.currentMatch === 0),
      `matches=${everyone.map((p) => p.gameState()?.currentMatch).join(",")}`,
    );

    await sleep(400);
    guests[0].vote({ round: 0, match: 0, choice: 0 });
    await waitForAll(
      everyone,
      (player) => player.gameState()?.pendingVoteCount === 2,
      { label: "second vote visible to all" },
    );
    pendingSeen.push(2);

    // A player changing their mind replaces their own vote rather than
    // counting twice - otherwise two clicks could settle a four-player match.
    host.vote({ round: 0, match: 0, choice: 1 });
    await sleep(400);
    t.check(
      "revote-replaces-instead-of-double-counting",
      everyone.every(
        (player) =>
          player.gameState()?.pendingVoteCount === 2 &&
          player.gameState()?.currentMatch === 0,
      ),
      `pending=${everyone.map((p) => p.gameState()?.pendingVoteCount).join(",")}`,
    );

    // Nobody can see how anyone voted while the match is live.
    const liveVotes =
      host.gameState()?.votesByMatch?.["0:0"] ?? {};
    t.check(
      "live-votes-are-redacted",
      Object.keys(liveVotes).length === 2 &&
        Object.values(liveVotes).every(
          (vote) => vote && !("choice" in vote) && typeof vote.at === "number",
        ),
      `liveVotes=${JSON.stringify(liveVotes)}`,
    );

    await sleep(400);
    guests[1].vote({ round: 0, match: 0, choice: 1 });
    await waitForAll(
      everyone,
      (player) => player.gameState()?.pendingVoteCount === 3,
      { label: "third vote visible to all" },
    );
    pendingSeen.push(3);
    t.check(
      "match-waits-for-the-last-voter",
      everyone.every((player) => player.gameState()?.currentMatch === 0),
      `matches=${everyone.map((p) => p.gameState()?.currentMatch).join(",")}`,
    );

    guests[2].vote({ round: 0, match: 0, choice: 1 });
    await waitForAll(
      everyone,
      (player) => player.gameState()?.currentMatch === 1,
      { label: "match resolves once the quorum is in" },
    );
    t.metric("pendingCountsObserved", pendingSeen);

    // Host revoted to 1, Ana 0, Ben 1, Cass 1 -> item 1 by 3 to 1.
    t.check(
      "majority-decides-the-match",
      everyone.every(
        (player) => player.gameState()?.lastWinner?.id === items[1].id,
      ),
      `winners=${everyone.map((p) => p.gameState()?.lastWinner?.id).join(",")} expected=${items[1].id}`,
    );

    const history = host.gameState()?.matchHistory?.[0];
    t.check(
      "settled-match-records-vote-counts",
      history?.voteCounts?.[items[1].id] === 3 &&
        history?.voteCounts?.[items[0].id] === 1,
      `voteCounts=${JSON.stringify(history?.voteCounts)}`,
    );

    t.check(
      "clients-in-sync-after-match",
      playersAreInSync(everyone),
      syncDigest(everyone).join(" | "),
    );

    // --- host can settle a stalled match ----------------------------------
    guests[0].forceAdvance();
    await guests[0].waitForMessage("force-denied", {
      label: "guest force denied",
      timeout: 5000,
    });
    t.check(
      "non-host-cannot-force-advance",
      guests[0].received("force-denied") &&
        everyone.every((player) => player.gameState()?.currentMatch === 1),
      `denied=${guests[0].received("force-denied")}`,
    );

    host.vote({ round: 0, match: 1, choice: 2 });
    await waitForAll(
      everyone,
      (player) => player.gameState()?.pendingVoteCount === 1,
      { label: "host vote on match 2" },
    );
    host.forceAdvance();
    await waitForAll(everyone, (player) => player.gameState()?.round === 1, {
      label: "host force-advance settles the match",
    });
    t.check(
      "host-force-advance-settles-with-votes-in-hand",
      everyone.every(
        (player) => player.gameState()?.lastWinner?.id === items[2].id,
      ),
      `winners=${everyone.map((p) => p.gameState()?.lastWinner?.id).join(",")} expected=${items[2].id}`,
    );

    // --- final round -------------------------------------------------------
    everyone.forEach((player) => player.vote({ round: 1, match: 0, choice: 0 }));
    await waitForAll(everyone, (player) => player.roomStatus() === "completed", {
      label: "final match completes for everyone",
    });
    t.check(
      "winner-announced-to-every-client",
      everyone.every(
        (player) => player.gameState()?.winner?.id === items[1].id,
      ),
      `winners=${everyone.map((p) => p.gameState()?.winner?.id).join(",")} expected=${items[1].id}`,
    );
    t.check(
      "clients-in-sync-at-the-finish",
      playersAreInSync(everyone),
      syncDigest(everyone).join(" | "),
    );

    t.remember("partySlug", slug);
    t.remember("partyItems", items);
    t.remember("partyHost", {
      participantId: host.participantId,
      token: host.token,
    });
    t.remember("partyGuest", {
      participantId: guests[0].participantId,
      token: guests[0].token,
    });
  },
);

scenario(
  "tie-breaks-with-a-coin-flip",
  {
    covers:
      "A tied match is decided by a coin flip, not by a fixed side winning every time",
  },
  async (t) => {
    // 32 items means 16 first-round matches, so two players splitting every
    // one of them gives 16 independent coin flips inside a single room.
    const items = makeItems(32, "tie");
    const slug = await createSession({ title: "QA Tie", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "TieHost" });
    t.cleanupPlayer(host);
    const rival = await Player.enter(slug, { name: "TieRival" });
    t.cleanupPlayer(rival);
    const both = [host, rival];

    await waitForAll(both, (player) => player.roster().length === 2, {
      label: "both tie players in the room",
    });

    host.startGame(items);
    await waitForAll(both, (player) => player.received("game-started"), {
      label: "tie game started",
    });

    const flips = [];
    for (let match = 0; match < 16; match += 1) {
      const leftIndex = match * 2;
      // A dead split: one vote each way.
      host.vote({ round: 0, match, choice: leftIndex });
      rival.vote({ round: 0, match, choice: leftIndex + 1 });

      const target = match + 1;
      await waitForAll(
        both,
        (player) =>
          player.gameState()?.round === 1 ||
          player.gameState()?.currentMatch === target,
        { label: `tie match ${match} resolves`, timeout: 10000 },
      );

      const settled = (host.gameState()?.matchHistory ?? []).find(
        (entry) => entry.round === 0 && entry.match === match,
      );
      flips.push({
        match,
        winner: settled?.winnerItemId,
        left: items[leftIndex].id,
        right: items[leftIndex + 1].id,
        voteCounts: settled?.voteCounts,
      });
    }

    const everyFlipWasATie = flips.every(
      (flip) =>
        flip.voteCounts?.[flip.left] === 1 && flip.voteCounts?.[flip.right] === 1,
    );
    t.check(
      "every-match-was-a-genuine-1-1-tie",
      everyFlipWasATie,
      `voteCounts=${JSON.stringify(flips.map((flip) => flip.voteCounts))}`,
    );

    const winnerIsAContender = flips.every(
      (flip) => flip.winner === flip.left || flip.winner === flip.right,
    );
    t.check(
      "tie-winner-is-one-of-the-two-contenders",
      winnerIsAContender,
      `flips=${JSON.stringify(flips.map((f) => f.winner))}`,
    );

    const leftWins = flips.filter((flip) => flip.winner === flip.left).length;
    t.metric("coinFlips", { total: flips.length, leftWins });
    // A fixed fallback would make this 16 or 0 every run. Both sides winning
    // at least once is what tells the two apart; a fair coin fails this about
    // three times in a hundred thousand runs.
    t.check(
      "tie-break-is-random-not-a-fixed-side",
      leftWins > 0 && leftWins < flips.length,
      `leftWins=${leftWins} of ${flips.length}`,
    );

    t.check(
      "both-clients-agree-on-every-tie-result",
      JSON.stringify(
        (rival.gameState()?.matchHistory ?? []).map((e) => e.winnerItemId),
      ) ===
        JSON.stringify(
          (host.gameState()?.matchHistory ?? []).map((e) => e.winnerItemId),
        ),
      "match history diverged between the two clients",
    );
  },
);

scenario(
  "quorum-follows-the-room",
  {
    covers:
      "Leaving lowers the bar to advance so one closed tab cannot stall the room",
  },
  async (t) => {
    const items = makeItems(4, "quorum");
    const slug = await createSession({ title: "QA Quorum", items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "QHost" });
    t.cleanupPlayer(host);
    const stayer = await Player.enter(slug, { name: "QStayer" });
    t.cleanupPlayer(stayer);
    const leaver = await Player.enter(slug, { name: "QLeaver" });
    t.cleanupPlayer(leaver);
    const all = [host, stayer, leaver];

    await waitForAll(all, (player) => player.roster().length === 3, {
      label: "three players in the quorum room",
    });
    host.startGame(items);
    await waitForAll(all, (player) => player.received("game-started"), {
      label: "quorum game started",
    });
    t.check(
      "quorum-starts-at-three",
      all.every((player) => player.gameState()?.requiredVoteCount === 3),
      `required=${all.map((p) => p.gameState()?.requiredVoteCount).join(",")}`,
    );

    host.vote({ round: 0, match: 0, choice: 0 });
    stayer.vote({ round: 0, match: 0, choice: 0 });
    await waitForAll(
      [host, stayer],
      (player) => player.gameState()?.pendingVoteCount === 2,
      { label: "two of three votes in" },
    );
    t.check(
      "match-held-open-for-the-third-player",
      host.gameState()?.currentMatch === 0,
      `currentMatch=${host.gameState()?.currentMatch}`,
    );

    // The third player closes their tab without voting.
    leaver.close();
    await waitForAll(
      [host, stayer],
      (player) => player.gameState()?.currentMatch === 1,
      { label: "match resolves after the third player leaves" },
    );
    t.check(
      "leaving-releases-the-match",
      host.gameState()?.currentMatch === 1 &&
        host.gameState()?.lastWinner?.id === items[0].id,
      `match=${host.gameState()?.currentMatch} winner=${host.gameState()?.lastWinner?.id}`,
    );
    t.check(
      "quorum-drops-to-the-remaining-players",
      [host, stayer].every(
        (player) => player.gameState()?.requiredVoteCount === 2,
      ),
      `required=${[host, stayer].map((p) => p.gameState()?.requiredVoteCount).join(",")}`,
    );
  },
);
