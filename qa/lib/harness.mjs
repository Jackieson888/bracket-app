// Shared plumbing for the QA suite: HTTP helpers, a websocket "player" that
// speaks the same protocol the browser client does, and the assertion and
// cleanup bookkeeping every scenario shares.
//
// The rule that matters here: a Player mirrors app/play/[slug]/
// play-bracket-game.tsx exactly - REST join to mint the participant token,
// socket connect, "join" for the display name, then "auth" with the token.
// An unauthenticated socket may watch the room but the server drops its votes,
// so a harness that skips the auth step silently tests nothing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import WebSocket from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function loadEnvLocal() {
  const env = {};
  try {
    const raw = readFileSync(path.join(repoRoot, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // No .env.local - the caller falls back to process.env.
  }
  return env;
}

export const config = {
  baseUrl: process.env.QA_BASE_URL || "http://localhost:3000",
  // Same origin by default, as in the browser. Split them when the websocket
  // runtime is run standalone (realtime-runtime/server.js), which is how it is
  // deployed behind the proxy.
  get wsUrl() {
    return (
      process.env.QA_WS_URL || `${this.baseUrl.replace(/^http/, "ws")}/ws`
    );
  },
  // Rate limits are keyed off x-forwarded-for, so each virtual device gets its
  // own address. Two players behind one hotspot would share a bucket in
  // production too - the rate-limit scenario pins a single key on purpose.
  nextIp: (() => {
    let n = 0;
    return () => `10.42.${Math.floor(n / 250) % 250}.${(n++ % 250) + 1}`;
  })(),
};

export async function api(route, { method = "GET", body, ip, headers } = {}) {
  const res = await fetch(`${config.baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip || config.nextIp(),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Some error paths return an empty body; the status is what we assert on.
  }
  return {
    status: res.status,
    ok: res.ok,
    body: payload,
    retryAfter: Number(res.headers.get("retry-after") || 0),
  };
}

let itemCounter = 0;

// Mirrors what app/create/page.tsx builds: a stable client-side id per item,
// which is also what the runtime keys vote tallies and match history on.
export function makeItems(count, prefix = "item") {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}-${Date.now().toString(36)}-${itemCounter++}`,
    title: `${prefix.toUpperCase()} ${index}`,
    mediaType: "image",
  }));
}

// POST /api/sessions is rate limited to 10/minute per key. Scenarios run back
// to back, so wait out the window rather than failing a scenario for a limiter
// that is working as designed.
export async function createSession(bracket, { ip, attempts = 3 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await api("/api/sessions", { method: "POST", body: bracket, ip });
    if (res.ok && res.body?.slug) {
      return res.body.slug;
    }
    if (res.status === 429 && attempt < attempts - 1) {
      await sleep(Math.min(res.retryAfter || 2, 61) * 1000);
      continue;
    }
    throw new Error(
      `createSession failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  throw new Error("createSession exhausted retries");
}

export async function joinSession(
  slug,
  { participantId, displayName, participantToken, ip },
) {
  return api(`/api/sessions/${slug}`, {
    method: "POST",
    ip,
    body: { participantId, displayName, participantToken },
  });
}

let playerCounter = 0;

export class Player {
  constructor({ slug, participantId, displayName, ip }) {
    this.slug = slug;
    this.participantId = participantId;
    this.displayName = displayName;
    this.ip = ip;
    this.messages = [];
    this.authenticated = false;
    this.token = null;
    this.ws = null;
    this.closed = false;
  }

  // The full browser sequence. `skipAuth` leaves the socket unverified, which
  // is how the auth scenario proves votes from an unproven socket are ignored.
  // `token` reuses a credential from an earlier connection - what a
  // reconnecting tab does with its stored token.
  static async enter(
    slug,
    { name = "Player", ip, participantId, token, skipAuth = false } = {},
  ) {
    const address = ip || config.nextIp();
    const id =
      participantId ||
      `qa-${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}-${playerCounter++}`;
    const player = new Player({
      slug,
      participantId: id,
      displayName: name,
      ip: address,
    });

    if (!skipAuth) {
      player.token = token ?? null;
      if (!player.token) {
        const joined = await joinSession(slug, {
          participantId: id,
          displayName: name,
          ip: address,
        });
        if (!joined.ok || !joined.body?.participantToken) {
          throw new Error(
            `REST join failed for ${name}: ${joined.status} ${JSON.stringify(joined.body)}`,
          );
        }
        player.token = joined.body.participantToken;
      }
    }

    await player.connect();
    player.send({ type: "join", slug, displayName: name, participantId: id });

    if (!skipAuth) {
      player.send({
        type: "auth",
        participantId: id,
        participantToken: player.token,
      });
      await player.waitForMessage("auth-ok", {
        timeout: 10000,
        label: `${name} auth-ok`,
      });
      player.authenticated = true;
    }

    return player;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${config.wsUrl}?slug=${encodeURIComponent(this.slug)}&participantId=${encodeURIComponent(this.participantId)}&displayName=${encodeURIComponent(this.displayName)}`;
      const ws = new WebSocket(url, {
        headers: { "x-forwarded-for": this.ip },
      });
      this.ws = ws;
      this.closed = false;

      const timer = setTimeout(
        () => reject(new Error(`Timeout connecting ${this.displayName}`)),
        10000,
      );

      // seq, not the clock: a room-state and a game-started routinely land in
      // the same millisecond, and picking the wrong one of those two reads the
      // board as it was before the game began.
      ws.on("message", (raw) => {
        const seq = this.messages.length;
        try {
          this.messages.push({
            at: Date.now(),
            seq,
            payload: JSON.parse(raw.toString()),
          });
        } catch (error) {
          this.messages.push({
            at: Date.now(),
            seq,
            payload: { type: "parse-error", error: String(error) },
          });
        }
      });
      ws.on("close", () => {
        this.closed = true;
      });
      ws.on("open", () => {
        clearTimeout(timer);
        resolve(this);
      });
      ws.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  vote({ round, match, choice }) {
    this.send({
      type: "vote",
      slug: this.slug,
      playerId: this.participantId,
      round,
      match,
      choice,
    });
  }

  startGame(items) {
    this.send({ type: "start-game", slug: this.slug, currentRoundItems: items });
  }

  forceAdvance() {
    this.send({ type: "force-advance", slug: this.slug });
  }

  received(type) {
    return this.messages.some((entry) => entry.payload?.type === type);
  }

  latest(type) {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].payload?.type === type) return this.messages[i];
    }
    return null;
  }

  // room-state, game-started and vote-update all carry game state; the newest
  // one to arrive is what this client is currently showing.
  view() {
    let newest = null;
    for (const entry of this.messages) {
      const type = entry.payload?.type;
      if (
        type !== "room-state" &&
        type !== "vote-update" &&
        type !== "game-started"
      ) {
        continue;
      }
      if (!newest || entry.seq > newest.seq) {
        newest = entry;
      }
    }
    return newest?.payload ?? null;
  }

  gameState() {
    return this.view()?.gameState ?? null;
  }

  roomStatus() {
    return this.view()?.roomStatus ?? null;
  }

  roster() {
    return (this.latest("room-state")?.payload?.clients ?? [])
      .map((client) => client.id)
      .sort();
  }

  hostId() {
    return this.latest("room-state")?.payload?.hostParticipantId ?? null;
  }

  async waitFor(predicate, { timeout = 8000, label = "condition" } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate(this)) return true;
      await sleep(20);
    }
    throw new Error(`Timeout waiting for ${label} (${this.displayName})`);
  }

  waitForMessage(type, { timeout = 8000, label, predicate } = {}) {
    return this.waitFor(
      (player) => {
        const entry = player.latest(type);
        return Boolean(entry) && (!predicate || predicate(entry.payload));
      },
      { timeout, label: label || `message ${type}` },
    );
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // Already gone.
    }
  }
}

export async function waitForAll(
  players,
  predicate,
  { timeout = 8000, label = "all players" } = {},
) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (players.every((player) => predicate(player))) return true;
    await sleep(20);
  }
  const seen = players.map((player) => {
    const state = player.gameState();
    return `${player.displayName}[status=${player.roomStatus()} round=${state?.round} match=${state?.currentMatch} pending=${state?.pendingVoteCount}/${state?.requiredVoteCount}]`;
  });
  throw new Error(`Timeout waiting for ${label}. Saw ${seen.join(" ")}`);
}

export async function waitForSnapshot(
  slug,
  predicate,
  { timeout = 6000, label = "session snapshot" } = {},
) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await api(`/api/sessions/${slug}`);
    if (predicate(last)) return last;
    await sleep(100);
  }
  throw new Error(
    `Timeout waiting for ${label}. Last: ${JSON.stringify({
      status: last?.status,
      roomStatus: last?.body?.roomStatus,
      round: last?.body?.gameState?.round,
      match: last?.body?.gameState?.currentMatch,
    })}`,
  );
}

// Every client in the room should be showing the same board. Returns a
// printable digest per player so a mismatch is readable in the report.
export function syncDigest(players) {
  return players.map((player) => {
    const state = player.gameState();
    return JSON.stringify({
      who: player.displayName,
      status: player.roomStatus(),
      round: state?.round ?? null,
      match: state?.currentMatch ?? null,
      items: (state?.currentRoundItems ?? []).map((item) => item.id),
      winner: state?.winner?.id ?? null,
    });
  });
}

export function playersAreInSync(players) {
  const digests = players.map((player) => {
    const state = player.gameState();
    return JSON.stringify({
      status: player.roomStatus(),
      round: state?.round ?? null,
      match: state?.currentMatch ?? null,
      items: (state?.currentRoundItems ?? []).map((item) => item.id),
      winner: state?.winner?.id ?? null,
    });
  });
  return digests.every((digest) => digest === digests[0]);
}

// A scenario that walks away from a game in progress leaves a room whose match
// timer keeps firing: it force-advances every vote window until the bracket
// finishes, and records a game result long after the run has swept its data -
// one orphan document per abandoned room. Settling the room here (the host's
// force-advance ends a match immediately) means the result is written while the
// runner can still delete it.
export async function settleAbandonedRooms(players) {
  const bySlug = new Map();
  for (const player of players) {
    if (!player.slug || player.closed) continue;
    if (!bySlug.has(player.slug)) bySlug.set(player.slug, []);
    bySlug.get(player.slug).push(player);
  }

  for (const group of bySlug.values()) {
    for (let step = 0; step < 64; step += 1) {
      const live = group.filter(
        (player) => !player.closed && player.roomStatus() === "started",
      );
      if (live.length === 0) break;

      const before = JSON.stringify(
        live.map((player) => [
          player.gameState()?.round,
          player.gameState()?.currentMatch,
        ]),
      );
      live.forEach((player) => player.forceAdvance());

      let moved = false;
      for (let wait = 0; wait < 40 && !moved; wait += 1) {
        await sleep(25);
        moved =
          live.some((player) => player.roomStatus() === "completed") ||
          JSON.stringify(
            live.map((player) => [
              player.gameState()?.round,
              player.gameState()?.currentMatch,
            ]),
          ) !== before;
      }
      // Nobody in this group could move the room on - most likely none of them
      // is the host. Leave it; the sweep will miss its result document.
      if (!moved) break;
    }
  }
}

// --- scenario registry -----------------------------------------------------

const registry = [];

export function scenario(name, meta, run) {
  registry.push({
    name,
    covers: meta.covers,
    slow: Boolean(meta.slow),
    run,
  });
}

export function allScenarios() {
  return registry;
}
