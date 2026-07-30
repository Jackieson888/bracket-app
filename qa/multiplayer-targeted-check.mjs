import WebSocket from "ws";

const baseUrl = "http://localhost:3000";
const wsBase = "ws://localhost:3000/ws";
const latencyThresholdMs = 100;

const out = { startedAt: new Date().toISOString(), checks: {}, metrics: {}, evidence: [], errors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, body };
}

function assert(pass, name, detail) {
  out.checks[name] = { pass: !!pass, detail };
  if (!pass) out.errors.push(`${name}: ${detail}`);
}

function latestByType(messages, type) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.payload?.type === type) return messages[i];
  }
  return null;
}

async function connect(slug, participantId, displayName) {
  const messages = [];
  const ws = await new Promise((resolve, reject) => {
    const sock = new WebSocket(`${wsBase}?slug=${slug}`);
    const t = setTimeout(() => reject(new Error("connect timeout")), 5000);
    sock.on("open", () => {
      clearTimeout(t);
      sock.send(JSON.stringify({ type: "join", slug, participantId, displayName }));
      resolve(sock);
    });
    sock.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    sock.on("message", (raw) => {
      try { messages.push({ at: Date.now(), payload: JSON.parse(raw.toString()) }); }
      catch (e) { messages.push({ at: Date.now(), payload: { parseError: String(e) } }); }
    });
  });

  return { ws, messages };
}

async function waitFor(fn, label, timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function main() {
  const items = [
    { _id: "A", title: "Alpha" },
    { _id: "B", title: "Bravo" },
    { _id: "C", title: "Charlie" },
    { _id: "D", title: "Delta" },
  ];

  const create = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "Targeted QA", items, user: { name: "QA Host" } }),
  });
  if (!create.ok || !create.body?.slug) throw new Error(`create failed ${JSON.stringify(create)}`);
  const slug = create.body.slug;
  out.metrics.slug = slug;

  const hostId = `qa-host-${Date.now()}`;
  const friendId = `qa-friend-${Date.now()}`;

  const missing = await api(`/api/sessions/${slug}ZZ`);
  assert(missing.status === 404, "missing-slug-404", `status=${missing.status}`);

  const joinHost = await api(`/api/sessions/${slug}`, { method: "POST", body: JSON.stringify({ participantId: hostId, displayName: "Host QA" }) });
  const joinFriend = await api(`/api/sessions/${slug}`, { method: "POST", body: JSON.stringify({ participantId: friendId, displayName: "Friend QA" }) });
  assert(joinHost.ok && joinFriend.ok, "join-api-ok", `host=${joinHost.status}, friend=${joinFriend.status}`);

  let snap = await api(`/api/sessions/${slug}`);
  const lookup = snap.body?.participantLookup || {};
  assert(!!lookup[hostId] && !!lookup[friendId], "join-roster-persistence", `keys=${Object.keys(lookup).join(",")}`);

  const c = await connect(slug, hostId, "Host QA");
  await waitFor(() => !!latestByType(c.messages, "room-state"), "initial room-state");

  c.ws.send(JSON.stringify({ type: "start-game", slug, currentRoundItems: items }));
  await waitFor(() => !!latestByType(c.messages, "game-started"), "game-started");

  const startMsg = latestByType(c.messages, "game-started");
  assert(startMsg?.payload?.roomStatus === "started", "start-game", `roomStatus=${startMsg?.payload?.roomStatus}`);

  c.ws.send(JSON.stringify({ type: "vote", slug, playerId: hostId, round: 0, match: 0, choice: 0 }));
  c.ws.send(JSON.stringify({ type: "vote", slug, playerId: hostId, round: 0, match: 0, choice: 0 }));
  const tVote2 = Date.now();
  c.ws.send(JSON.stringify({ type: "vote", slug, playerId: friendId, round: 0, match: 0, choice: 0 }));

  await waitFor(() => {
    const vu = latestByType(c.messages, "vote-update")?.payload?.gameState;
    return vu?.round === 0 && vu?.currentMatch === 1;
  }, "first match resolve");

  const vu1 = latestByType(c.messages, "vote-update");
  const latency = vu1.at - tVote2;
  out.metrics.firstVoteResolveLatencyMs = latency;
  assert(latency <= latencyThresholdMs, "latency-threshold", `latency=${latency}ms threshold=${latencyThresholdMs}ms`);

  const gs1 = vu1?.payload?.gameState;
  assert(gs1?.round === 0 && gs1?.currentMatch === 1, "vote-aggregation", `round=${gs1?.round}, currentMatch=${gs1?.currentMatch}`);

  c.ws.send(JSON.stringify({ type: "vote", slug, playerId: hostId, round: 0, match: 1, choice: 2 }));
  c.ws.send(JSON.stringify({ type: "vote", slug, playerId: friendId, round: 0, match: 1, choice: 2 }));

  await waitFor(() => {
    const vu = latestByType(c.messages, "vote-update")?.payload?.gameState;
    return vu?.round === 1 && vu?.currentMatch === 0 && Array.isArray(vu?.currentRoundItems) && vu.currentRoundItems.length === 2;
  }, "to final round");

  const beforeDisconnect = latestByType(c.messages, "vote-update")?.payload;
  out.evidence.push({ step: "before-disconnect", roomStatus: beforeDisconnect?.roomStatus, gameState: beforeDisconnect?.gameState });

  c.ws.close();
  await sleep(800);

  snap = await api(`/api/sessions/${slug}`);
  assert(snap.body?.roomStatus === "started" && snap.body?.gameState?.round === 1 && snap.body?.gameState?.currentMatch === 0, "persist-after-disconnect", `roomStatus=${snap.body?.roomStatus}, round=${snap.body?.gameState?.round}, match=${snap.body?.gameState?.currentMatch}`);

  const c2 = await connect(slug, hostId, "Host QA");
  await waitFor(() => {
    const rs = latestByType(c2.messages, "room-state")?.payload;
    return rs?.roomStatus === "started" && rs?.gameState?.round === 1 && rs?.gameState?.currentMatch === 0;
  }, "hydrate after reconnect");

  const hyd1 = latestByType(c2.messages, "room-state")?.payload;
  assert(hyd1?.roomStatus === "started" && hyd1?.gameState?.round === 1 && hyd1?.gameState?.currentMatch === 0, "reconnect-hydration-started", `roomStatus=${hyd1?.roomStatus}, round=${hyd1?.gameState?.round}, match=${hyd1?.gameState?.currentMatch}`);

  c2.ws.send(JSON.stringify({ type: "vote", slug, playerId: hostId, round: 1, match: 0, choice: 0 }));
  c2.ws.send(JSON.stringify({ type: "vote", slug, playerId: friendId, round: 1, match: 0, choice: 0 }));

  await waitFor(() => {
    const vu = latestByType(c2.messages, "vote-update")?.payload;
    return vu?.roomStatus === "completed" && vu?.gameState?.winner?._id === "A";
  }, "complete winner");

  const finalUpdate = latestByType(c2.messages, "vote-update")?.payload;
  assert(finalUpdate?.gameState?.winner?._id === "A", "winner-correctness", `winner=${finalUpdate?.gameState?.winner?._id}`);

  c2.ws.close();
  await sleep(800);

  const c3 = await connect(slug, hostId, "Host QA");
  await waitFor(() => {
    const rs = latestByType(c3.messages, "room-state")?.payload;
    return rs?.roomStatus === "completed" && rs?.gameState?.round === 1 && rs?.gameState?.currentMatch === 0 && rs?.gameState?.winner?._id === "A";
  }, "hydrate completed");

  const hyd2 = latestByType(c3.messages, "room-state")?.payload;
  assert(hyd2?.roomStatus === "completed" && hyd2?.gameState?.round === 1 && hyd2?.gameState?.currentMatch === 0 && hyd2?.gameState?.winner?._id === "A", "reconnect-hydration-full", `roomStatus=${hyd2?.roomStatus}, round=${hyd2?.gameState?.round}, match=${hyd2?.gameState?.currentMatch}, winner=${hyd2?.gameState?.winner?._id}`);

  c3.ws.close();
  await sleep(500);

  snap = await api(`/api/sessions/${slug}`);
  out.evidence.push({ step: "final-snapshot", roomStatus: snap.body?.roomStatus, gameState: snap.body?.gameState, participantIds: snap.body?.participantIds, participantLookupKeys: Object.keys(snap.body?.participantLookup || {}) });

  assert(Array.isArray(snap.body?.participantIds) && snap.body.participantIds.includes(hostId) && snap.body.participantIds.includes(friendId), "join-roster-final", `participantIds=${JSON.stringify(snap.body?.participantIds || [])}`);

  out.finishedAt = new Date().toISOString();
  out.passCount = Object.values(out.checks).filter((v) => v.pass).length;
  out.failCount = Object.values(out.checks).filter((v) => !v.pass).length;

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  out.errors.push(String(err?.stack || err));
  out.finishedAt = new Date().toISOString();
  out.passCount = Object.values(out.checks).filter((v) => v.pass).length;
  out.failCount = Object.values(out.checks).filter((v) => !v.pass).length;
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = 1;
});
