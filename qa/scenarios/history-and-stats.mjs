// After the confetti: the durable record of a finished game, and the play
// counts the bracket cards on /play read back out of it.
import {
  api,
  createSession,
  makeItems,
  Player,
  scenario,
  sleep,
  waitForAll,
} from "../lib/harness.mjs";

scenario(
  "game-history-and-bracket-stats",
  {
    covers:
      "A finished game is recorded and feeds the play counts shown on bracket cards",
  },
  async (t) => {
    const items = makeItems(4, "stat");
    const title = `QA Stats ${Date.now()}`;

    const created = await api("/api/brackets", {
      method: "POST",
      body: { title, items },
    });
    const bracketId = created.body?.id;
    t.check(
      "stats-bracket-created",
      created.ok && Boolean(bracketId),
      `status=${created.status} body=${JSON.stringify(created.body)}`,
    );
    if (bracketId) t.trackBracket(bracketId);

    const before = await api(`/api/brackets/${bracketId}/stats`);
    t.check(
      "new-bracket-has-no-plays",
      before.ok && before.body?.totalPlays === 0,
      `status=${before.status} totalPlays=${before.body?.totalPlays}`,
    );

    // The session has to carry the bracket _id, or the finished game cannot be
    // attributed back to the bracket.
    const slug = await createSession({ _id: bracketId, title, items });
    t.trackSession(slug);

    const host = await Player.enter(slug, { name: "StatHost" });
    t.cleanupPlayer(host);
    const friend = await Player.enter(slug, { name: "StatFriend" });
    t.cleanupPlayer(friend);
    const dissenter = await Player.enter(slug, { name: "StatDissenter" });
    t.cleanupPlayer(dissenter);
    const table = [host, friend, dissenter];

    await waitForAll(table, (player) => player.roster().length === 3, {
      label: "all three stat players connected",
    });
    host.startGame(items);
    await waitForAll(table, (player) => player.received("game-started"), {
      label: "stats game started",
    });

    // A deterministic bracket with one split decision, so the stored match log
    // has a real spread of votes rather than a single unanimous column:
    // items[0] takes match 0 by 2-1, items[2] sweeps match 1, items[0] wins.
    const script = [
      { round: 0, match: 0, choices: [0, 0, 1] },
      { round: 0, match: 1, choices: [2, 2, 2] },
      { round: 1, match: 0, choices: [0, 0, 0] },
    ];

    for (const { round, match, choices } of script) {
      table.forEach((player, index) =>
        player.vote({ round, match, choice: choices[index] }),
      );
      await waitForAll(
        table,
        (player) =>
          player.roomStatus() === "completed" ||
          player.gameState()?.round > round ||
          player.gameState()?.currentMatch > match,
        { label: `stats match ${round}:${match} settles` },
      );
    }

    await waitForAll(table, (player) => player.roomStatus() === "completed", {
      label: "stats game completed",
    });

    // The write happens after the broadcast, so give it a moment to land.
    let stats = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      stats = await api(`/api/brackets/${bracketId}/stats`);
      if (stats.body?.totalPlays > 0) break;
      await sleep(250);
    }

    t.check(
      "finished-game-counted-as-a-play",
      stats?.body?.totalPlays === 1,
      `totalPlays=${stats?.body?.totalPlays}`,
    );

    const winnerStat = (stats?.body?.itemStats ?? []).find(
      (stat) => stat.itemId === items[0].id,
    );
    t.check(
      "item-records-survive-with-real-ids",
      winnerStat?.wins === 2,
      `itemStats=${JSON.stringify(stats?.body?.itemStats)}`,
    );

    t.check(
      "closest-match-captures-real-vote-counts",
      Object.values(stats?.body?.closestMatch?.voteCounts ?? {}).some(
        (count) => count === 2,
      ),
      `closestMatch=${JSON.stringify(stats?.body?.closestMatch)}`,
    );

    // Same summary, this time through the list endpoint the play page uses.
    const listed = await api(`/api/brackets?search=${encodeURIComponent(title)}`);
    const card = (listed.body?.brackets ?? []).find(
      (bracket) => bracket.title === title,
    );
    t.check(
      "bracket-card-shows-the-play-count",
      card?.stats?.playCount === 1,
      `stats=${JSON.stringify(card?.stats)}`,
    );
    t.check(
      "bracket-card-shows-the-winning-item",
      card?.stats?.topItemTitle === items[0].title,
      `topItemTitle=${card?.stats?.topItemTitle} expected=${items[0].title}`,
    );

    if (!t.mongo) {
      t.skip("game-result-document", "no Mongo connection for direct checks");
      return;
    }

    const doc = await t.mongo
      .db("prod")
      .collection("gameResults")
      .findOne({ slug });

    t.check(
      "game-result-document-written",
      Boolean(doc),
      `no gameResults document for slug=${slug}`,
    );
    t.check(
      "game-result-names-the-winner",
      doc?.winnerItemId === items[0].id &&
        doc?.winnerItemTitle === items[0].title,
      `winnerItemId=${doc?.winnerItemId} title=${doc?.winnerItemTitle}`,
    );
    t.check(
      "game-result-logs-every-match",
      (doc?.matchLog ?? []).length === 3 &&
        (doc?.matchLog ?? []).every(
          (entry) =>
            entry.wasBye || Object.values(entry.voteCounts ?? {}).length > 0,
        ),
      `matchLog=${JSON.stringify(doc?.matchLog)}`,
    );
    t.check(
      "guest-players-are-counted-but-not-named",
      doc?.guestParticipantCount === 3 &&
        (doc?.participantUserIds ?? []).length === 0 &&
        (doc?.participantPicks ?? []).length === 0,
      `guests=${doc?.guestParticipantCount} users=${JSON.stringify(doc?.participantUserIds)} picks=${(doc?.participantPicks ?? []).length}`,
    );
  },
);
