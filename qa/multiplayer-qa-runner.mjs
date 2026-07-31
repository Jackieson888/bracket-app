import WebSocket from "ws";

const baseUrl = "http://localhost:3000";
const wsBase = "ws://localhost:3000/ws";
const latencyThresholdMs = 100;

const out = {
  startedAt: new Date().toISOString(),
  baseUrl,
  latencyThresholdMs,
  checks: {},
  metrics: {},
  artifacts: [],
  errors: [],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, ok: res.ok, body };
}

function connectClient({ slug, participantId, displayName }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${wsBase}?slug=${encodeURIComponent(slug)}&participantId=${encodeURIComponent(participantId)}&displayName=${encodeURIComponent(displayName)}`,
    );
    const messages = [];
    let opened = false;
    const timeout = setTimeout(() => {
      if (!opened) {
        try {
          ws.close();
        } catch {}
        reject(new Error(`Timeout connecting ${participantId}`));
      }
    }, 5000);

    ws.on("message", (raw) => {
      try {
        messages.push({ at: Date.now(), payload: JSON.parse(raw.toString()) });
      } catch (err) {
        messages.push({ at: Date.now(), payload: { parseError: String(err) } });
      }
    });

    ws.on("open", () => {
      opened = true;
      clearTimeout(timeout);
      ws.send(
        JSON.stringify({ type: "join", slug, participantId, displayName }),
      );
      resolve({ ws, messages, participantId, displayName });
    });

    ws.on("error", (err) => {
      if (!opened) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function latestMessage(client, type) {
  for (let i = client.messages.length - 1; i >= 0; i -= 1) {
    if (client.messages[i]?.payload?.type === type) return client.messages[i];
  }
  return null;
}

function latestRoomState(client) {
  return latestMessage(client, "room-state")?.payload ?? null;
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function waitForSessionSnapshot(slug, predicate, timeoutMs, label) {
  const start = Date.now();
  let lastSnapshot = null;

  while (Date.now() - start < timeoutMs) {
    const snapshot = await api(`/api/sessions/${slug}`);
    lastSnapshot = snapshot;
    if (predicate(snapshot)) {
      return snapshot;
    }
    await sleep(50);
  }

  throw new Error(
    `Timeout waiting for ${label}. Last snapshot: ${JSON.stringify({ roomStatus: lastSnapshot?.body?.roomStatus, round: lastSnapshot?.body?.gameState?.round, currentMatch: lastSnapshot?.body?.gameState?.currentMatch, gameStateVersion: lastSnapshot?.body?.gameStateVersion, roomSnapshotVersion: lastSnapshot?.body?.roomSnapshotVersion })}`,
  );
}

function assert(condition, name, detail) {
  out.checks[name] = { pass: Boolean(condition), detail };
  if (!condition) out.errors.push(`${name} failed: ${detail}`);
}

async function main() {
  const bracketItems = [
    { _id: "A", title: "Alpha" },
    { _id: "B", title: "Bravo" },
    { _id: "C", title: "Charlie" },
    { _id: "D", title: "Delta" },
  ];
  const hostId = `qa-host-${Date.now()}`;
  const friendId = `qa-friend-${Date.now()}`;

  const createRes = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      title: "QA reconnect bracket",
      items: bracketItems,
      user: { name: "QA Host" },
    }),
  });
  if (!createRes.ok || !createRes.body?.slug)
    throw new Error(`Create session failed: ${JSON.stringify(createRes)}`);

  const slug = createRes.body.slug;
  out.metrics.slug = slug;
  out.artifacts.push({ step: "create-session", response: createRes.body });

  const missing = await api(`/api/sessions/${slug}ZZ`);
  assert(
    missing.status === 404,
    "missing-slug-404",
    `status=${missing.status}`,
  );

  const joinHostApi = await api(`/api/sessions/${slug}`, {
    method: "POST",
    body: JSON.stringify({ participantId: hostId, displayName: "Host QA" }),
  });
  const joinFriendApi = await api(`/api/sessions/${slug}`, {
    method: "POST",
    body: JSON.stringify({ participantId: friendId, displayName: "Friend QA" }),
  });
  assert(
    joinHostApi.ok && joinFriendApi.ok,
    "join-api-ok",
    `host=${joinHostApi.status}, friend=${joinFriendApi.status}`,
  );

  let snapshot = await api(`/api/sessions/${slug}`);
  const lookup = snapshot.body?.participantLookup || {};
  assert(
    Boolean(lookup[hostId]) && Boolean(lookup[friendId]),
    "join-roster-persistence-api",
    `keys=${Object.keys(lookup).join(",")}`,
  );

  let host = await connectClient({
    slug,
    participantId: hostId,
    displayName: "Host QA",
  });
  let friend = await connectClient({
    slug,
    participantId: friendId,
    displayName: "Friend QA",
  });

  await waitFor(
    () => {
      const hs = latestRoomState(host);
      const fs = latestRoomState(friend);
      const hIds = new Set((hs?.clients || []).map((c) => c.id));
      const fIds = new Set((fs?.clients || []).map((c) => c.id));
      return (
        hs?.slug === slug &&
        fs?.slug === slug &&
        hIds.has(hostId) &&
        hIds.has(friendId) &&
        fIds.has(hostId) &&
        fIds.has(friendId)
      );
    },
    10000,
    "both clients see participant ids",
  );

  const hs = latestRoomState(host);
  const fs = latestRoomState(friend);
  assert(
    hs?.slug === slug && fs?.slug === slug,
    "same-session-slug",
    `host=${hs?.slug} friend=${fs?.slug} expected=${slug}`,
  );

  const hostRosterIds = new Set((hs?.clients || []).map((c) => c.id));
  const friendRosterIds = new Set((fs?.clients || []).map((c) => c.id));
  assert(
    hostRosterIds.has(hostId) &&
      hostRosterIds.has(friendId) &&
      friendRosterIds.has(hostId) &&
      friendRosterIds.has(friendId),
    "same-roster-visible",
    `hostRoster=${Array.from(hostRosterIds).join(",")}; friendRoster=${Array.from(friendRosterIds).join(",")}`,
  );

  host.ws.send(
    JSON.stringify({
      type: "start-game",
      slug,
      currentRoundItems: bracketItems,
    }),
  );
  await waitFor(
    () =>
      Boolean(latestMessage(host, "game-started")) &&
      Boolean(latestMessage(friend, "game-started")),
    6000,
    "game-started on both",
  );
  assert(true, "start-game-state", "both clients received game-started");

  host.ws.send(
    JSON.stringify({
      type: "vote",
      slug,
      playerId: hostId,
      round: 0,
      match: 0,
      choice: 0,
    }),
  );
  host.ws.send(
    JSON.stringify({
      type: "vote",
      slug,
      playerId: hostId,
      round: 0,
      match: 0,
      choice: 0,
    }),
  );
  const t2 = Date.now();
  friend.ws.send(
    JSON.stringify({
      type: "vote",
      slug,
      playerId: friendId,
      round: 0,
      match: 0,
      choice: 0,
    }),
  );

  await waitFor(
    () => {
      const hgs = latestMessage(host, "vote-update")?.payload?.gameState;
      const fgs = latestMessage(friend, "vote-update")?.payload?.gameState;
      return (
        hgs?.round === 0 &&
        hgs?.currentMatch === 1 &&
        fgs?.round === 0 &&
        fgs?.currentMatch === 1
      );
    },
    6000,
    "first match resolved",
  );

  const hv1 = latestMessage(host, "vote-update");
  const fv1 = latestMessage(friend, "vote-update");
  const hostLatency = hv1.at - t2;
  const friendLatency = fv1.at - t2;
  out.metrics.firstResolveLatencyMs = {
    host: hostLatency,
    friend: friendLatency,
  };
  assert(
    hostLatency <= latencyThresholdMs && friendLatency <= latencyThresholdMs,
    "realtime-latency-under-threshold",
    `host=${hostLatency} friend=${friendLatency} threshold=${latencyThresholdMs}`,
  );

  const gs1 = hv1?.payload?.gameState;
  assert(
    gs1?.round === 0 && gs1?.currentMatch === 1,
    "vote-aggregation-no-double-advance",
    `round=${gs1?.round}, currentMatch=${gs1?.currentMatch}`,
  );

  host.ws.send(
    JSON.stringify({
      type: "vote",
      slug,
      playerId: hostId,
      round: 0,
      match: 1,
      choice: 2,
    }),
  );
  friend.ws.send(
    JSON.stringify({
      type: "vote",
      slug,
      playerId: friendId,
      round: 0,
      match: 1,
      choice: 2,
    }),
  );

  await waitFor(
    () => {
      const hgs = latestMessage(host, "vote-update")?.payload?.gameState;
      const fgs = latestMessage(friend, "vote-update")?.payload?.gameState;
      return (
        hgs?.round === 1 &&
        hgs?.currentMatch === 0 &&
        fgs?.round === 1 &&
        fgs?.currentMatch === 0
      );
    },
    6000,
    "advance to final round",
  );

  out.artifacts.push({
    step: "pre-disconnect",
    state: latestMessage(host, "vote-update")?.payload,
  });

  host.ws.close();
  friend.ws.close();
  await sleep(1000);

  snapshot = await waitForSessionSnapshot(
    slug,
    (nextSnapshot) =>
      nextSnapshot.ok &&
      nextSnapshot.body?.roomStatus === "started" &&
      nextSnapshot.body?.gameState?.round === 1 &&
      nextSnapshot.body?.gameState?.currentMatch === 0,
    2500,
    "persisted round-1 state after full disconnect",
  );
  assert(
    snapshot.ok &&
      snapshot.body?.roomStatus === "started" &&
      snapshot.body?.gameState?.round === 1 &&
      snapshot.body?.gameState?.currentMatch === 0,
    "state-persisted-after-full-disconnect",
    `roomStatus=${snapshot.body?.roomStatus} round=${snapshot.body?.gameState?.round} match=${snapshot.body?.gameState?.currentMatch}`,
  );

  host = await connectClient({
    slug,
    participantId: hostId,
    displayName: "Host QA",
  });
  friend = await connectClient({
    slug,
    participantId: friendId,
    displayName: "Friend QA",
  });

  await waitFor(
    () => {
      const h = latestRoomState(host);
      const f = latestRoomState(friend);
      return (
        h?.roomStatus === "started" &&
        f?.roomStatus === "started" &&
        h?.gameState?.round === 1 &&
        h?.gameState?.currentMatch === 0 &&
        f?.gameState?.round === 1
      );
    },
    8000,
    "reconnect hydration started",
  );

  const hydratedH = latestRoomState(host);
  const hydratedF = latestRoomState(friend);
  assert(
    hydratedH?.gameState?.round === 1 &&
      hydratedH?.gameState?.currentMatch === 0 &&
      hydratedF?.gameState?.round === 1,
    "reconnect-hydration-round-currentMatch",
    `host round=${hydratedH?.gameState?.round} match=${hydratedH?.gameState?.currentMatch}; friend round=${hydratedF?.gameState?.round}`,
  );

  host.ws.send(
    JSON.stringify({
      type: "vote",
      slug,
      playerId: hostId,
      round: 1,
      match: 0,
      choice: 0,
    }),
  );
  friend.ws.send(
    JSON.stringify({
      type: "vote",
      slug,
      playerId: friendId,
      round: 1,
      match: 0,
      choice: 0,
    }),
  );

  await waitFor(
    () => {
      const h = latestMessage(host, "vote-update")?.payload;
      const f = latestMessage(friend, "vote-update")?.payload;
      return (
        h?.roomStatus === "completed" &&
        f?.roomStatus === "completed" &&
        h?.gameState?.winner?._id === "A" &&
        f?.gameState?.winner?._id === "A"
      );
    },
    7000,
    "winner complete",
  );

  const completed = latestMessage(host, "vote-update")?.payload;
  assert(
    completed?.gameState?.winner?._id === "A",
    "winner-correctness",
    `winner=${completed?.gameState?.winner?._id}`,
  );

  host.ws.close();
  friend.ws.close();
  await sleep(1000);

  const reconnectFinal = await connectClient({
    slug,
    participantId: hostId,
    displayName: "Host QA",
  });
  await waitFor(
    () => {
      const m = latestRoomState(reconnectFinal);
      return (
        m?.roomStatus === "completed" &&
        m?.gameState?.round === 1 &&
        m?.gameState?.currentMatch === 0 &&
        m?.gameState?.winner?._id === "A"
      );
    },
    8000,
    "final hydration",
  );

  const m = latestRoomState(reconnectFinal);
  assert(
    m?.roomStatus === "completed" &&
      m?.gameState?.round === 1 &&
      m?.gameState?.currentMatch === 0 &&
      m?.gameState?.winner?._id === "A",
    "reconnect-hydration-roomStatus-round-currentMatch-winner",
    `roomStatus=${m?.roomStatus}, round=${m?.gameState?.round}, match=${m?.gameState?.currentMatch}, winner=${m?.gameState?.winner?._id}`,
  );

  reconnectFinal.ws.close();
  await sleep(300);

  snapshot = await api(`/api/sessions/${slug}`);
  out.artifacts.push({
    step: "final-session-snapshot",
    roomStatus: snapshot.body?.roomStatus,
    gameState: snapshot.body?.gameState,
    participantIds: snapshot.body?.participantIds,
    participantLookupKeys: Object.keys(snapshot.body?.participantLookup || {}),
  });

  const participantIds = snapshot.body?.participantIds || [];
  assert(
    Array.isArray(participantIds) &&
      participantIds.includes(hostId) &&
      participantIds.includes(friendId),
    "join-roster-persistence-final",
    `participantIds=${JSON.stringify(participantIds)}`,
  );

  out.finishedAt = new Date().toISOString();
  out.passCount = Object.values(out.checks).filter((v) => v.pass).length;
  out.failCount = Object.values(out.checks).filter((v) => !v.pass).length;
  console.log(JSON.stringify(out, null, 2));
  if (out.failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  out.errors.push(String(err?.stack || err));
  out.finishedAt = new Date().toISOString();
  out.passCount = Object.values(out.checks).filter((v) => v.pass).length;
  out.failCount = Object.values(out.checks).filter((v) => !v.pass).length;
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = 1;
});
