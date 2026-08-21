// Getting in the door: making a bracket, turning it into a room, and playing
// one through on your own.
import {
  api,
  config,
  createSession,
  makeItems,
  Player,
  scenario,
  waitForSnapshot,
} from "../lib/harness.mjs";

scenario(
  "create-bracket",
  { covers: "A user can create a bracket, find it again, and launch it" },
  async (t) => {
    const items = makeItems(4, "seed");
    const title = `QA Bracket ${Date.now()}`;

    // Exactly what app/create/page.tsx handleSaveBracket posts.
    const created = await api("/api/brackets", {
      method: "POST",
      body: { title, description: "created by the QA suite", items },
    });
    t.check(
      "bracket-create-accepted",
      created.ok && created.body?.success && created.body?.id,
      `status=${created.status} body=${JSON.stringify(created.body)}`,
    );
    if (created.body?.id) t.trackBracket(created.body.id);

    // app/create/page.tsx now routes to /play after a save, and /play lists the
    // newest brackets - so the bracket has to come back from that same list.
    const newest = await api("/api/brackets");
    const inNewest = (newest.body?.brackets ?? []).some(
      (bracket) => bracket.title === title,
    );
    t.check(
      "bracket-appears-on-play-page",
      inNewest,
      `newest titles=${JSON.stringify((newest.body?.brackets ?? []).map((b) => b.title))}`,
    );

    const searched = await api(
      `/api/brackets?search=${encodeURIComponent(title)}`,
    );
    const found = (searched.body?.brackets ?? []).find(
      (bracket) => bracket.title === title,
    );
    t.check(
      "bracket-search-finds-it",
      Boolean(found),
      `status=${searched.status} count=${(searched.body?.brackets ?? []).length}`,
    );

    t.check(
      "bracket-items-round-trip",
      found?.items?.length === items.length &&
        found.items.every((item, index) => item.title === items[index].title) &&
        found.items.every((item) => typeof item.id === "string" && item.id),
      `items=${JSON.stringify(found?.items?.map((item) => ({ id: item.id, title: item.title })))}`,
    );

    // The play button on a bracket card: bracket -> room code.
    const slug = await createSession(found ?? { title, items });
    t.trackSession(slug);
    t.metric("slug", slug);

    const snapshot = await api(`/api/sessions/${slug}`);
    t.check(
      "session-created-in-waiting",
      snapshot.ok && snapshot.body?.roomStatus === "waiting",
      `status=${snapshot.status} roomStatus=${snapshot.body?.roomStatus}`,
    );
    t.check(
      "session-carries-bracket-items",
      snapshot.body?.bracket?.items?.length === items.length,
      `items=${snapshot.body?.bracket?.items?.length}`,
    );
    t.check(
      "session-hides-participant-tokens",
      Object.values(snapshot.body?.participantLookup ?? {}).every(
        (entry) => !("participantToken" in entry),
      ),
      `lookup=${JSON.stringify(snapshot.body?.participantLookup ?? {})}`,
    );

    // The lobby shows a QR code for the room; it is rendered server-side.
    const qr = await fetch(`${config.baseUrl}/api/sessions/${slug}/qr`, {
      headers: { "x-forwarded-for": "10.99.0.1" },
    });
    const qrBody = await qr.text();
    t.check(
      "room-qr-code-renders",
      qr.ok && qrBody.includes("<svg"),
      `status=${qr.status} body=${qrBody.slice(0, 60)}`,
    );

    const missing = await api(`/api/sessions/${slug}ZZ`);
    t.check(
      "unknown-room-code-404",
      missing.status === 404,
      `status=${missing.status}`,
    );

    const empty = await api("/api/sessions", {
      method: "POST",
      body: { title: "empty", items: [] },
    });
    t.check(
      "empty-bracket-rejected",
      empty.status === 400,
      `status=${empty.status} body=${JSON.stringify(empty.body)}`,
    );
  },
);

scenario(
  "solo-game",
  { covers: "A single user can start and finish a game alone" },
  async (t) => {
    const items = makeItems(4, "solo");
    const slug = await createSession({ title: "QA Solo", items });
    t.trackSession(slug);

    const solo = await Player.enter(slug, { name: "Solo" });
    t.cleanupPlayer(solo);

    await solo.waitFor((player) => player.hostId() === player.participantId, {
      label: "solo player becomes host",
    });
    t.check(
      "solo-player-is-host",
      solo.hostId() === solo.participantId,
      `host=${solo.hostId()} me=${solo.participantId}`,
    );
    t.check(
      "solo-room-starts-in-waiting",
      solo.roomStatus() === "waiting",
      `roomStatus=${solo.roomStatus()}`,
    );

    solo.startGame(items);
    await solo.waitForMessage("game-started", { label: "solo game-started" });

    t.check(
      "solo-quorum-is-one",
      solo.gameState()?.requiredVoteCount === 1,
      `requiredVoteCount=${solo.gameState()?.requiredVoteCount}`,
    );
    t.check(
      "solo-first-match-armed",
      Number(solo.gameState()?.matchDeadline) > Date.now(),
      `matchDeadline=${solo.gameState()?.matchDeadline}`,
    );

    // One player is the whole quorum, so every vote settles its match at once.
    solo.vote({ round: 0, match: 0, choice: 0 });
    await solo.waitFor((player) => player.gameState()?.currentMatch === 1, {
      label: "solo advance to match 1",
    });

    solo.vote({ round: 0, match: 1, choice: 2 });
    await solo.waitFor((player) => player.gameState()?.round === 1, {
      label: "solo advance to round 1",
    });
    t.check(
      "solo-round-advances-alone",
      solo.gameState()?.round === 1 && solo.gameState()?.currentMatch === 0,
      `round=${solo.gameState()?.round} match=${solo.gameState()?.currentMatch}`,
    );

    solo.vote({ round: 1, match: 0, choice: 0 });
    await solo.waitFor((player) => player.roomStatus() === "completed", {
      label: "solo game completed",
    });

    t.check(
      "solo-winner-is-their-pick",
      solo.gameState()?.winner?.id === items[0].id,
      `winner=${solo.gameState()?.winner?.id} expected=${items[0].id}`,
    );

    const snapshot = await waitForSnapshot(
      slug,
      (res) => res.body?.roomStatus === "completed",
      { label: "solo completion persisted" },
    );
    t.check(
      "solo-result-persisted",
      snapshot.body?.gameState?.winner?.id === items[0].id,
      `persisted winner=${snapshot.body?.gameState?.winner?.id}`,
    );
  },
);

scenario(
  "bye-handling",
  { covers: "An odd-sized bracket gives the leftover item a bye" },
  async (t) => {
    // 5 items: round 0 is two matches plus a bye for the fifth.
    const items = makeItems(5, "odd");
    const slug = await createSession({ title: "QA Odd", items });
    t.trackSession(slug);

    const solo = await Player.enter(slug, { name: "Odd" });
    t.cleanupPlayer(solo);
    await solo.waitFor((player) => player.hostId() === player.participantId, {
      label: "host assigned",
    });

    solo.startGame(items);
    await solo.waitForMessage("game-started", { label: "odd game-started" });

    solo.vote({ round: 0, match: 0, choice: 0 });
    await solo.waitFor((player) => player.gameState()?.currentMatch === 1, {
      label: "odd advance to match 1",
    });
    solo.vote({ round: 0, match: 1, choice: 2 });
    await solo.waitFor((player) => player.gameState()?.round === 1, {
      label: "odd advance to round 1",
    });

    const round1Items = solo.gameState()?.currentRoundItems ?? [];
    t.check(
      "bye-carries-fifth-item-forward",
      round1Items.length === 3 &&
        round1Items.some((item) => item.id === items[4].id),
      `round1=${JSON.stringify(round1Items.map((item) => item.id))}`,
    );

    const byeEntry = (solo.gameState()?.matchHistory ?? []).find(
      (entry) => entry.wasBye,
    );
    t.check(
      "bye-recorded-in-match-history",
      byeEntry?.winnerItemId === items[4].id,
      `byeEntry=${JSON.stringify(byeEntry)}`,
    );
  },
);
