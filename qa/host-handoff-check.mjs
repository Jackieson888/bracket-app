// Exercises host assignment and the disconnect handoff against a locally
// running server (npm run dev). Start the server with a short grace window:
//   HOST_HANDOFF_GRACE_MS=1500 npm run dev
import WebSocket from "ws";

// argv[2] serves the Next API, argv[3] the websocket runtime. They are the same
// origin in production; split here so the runtime can be tested standalone.
const base = process.argv[2] || "http://localhost:3000";
const wsBase = (process.argv[3] || base).replace(/^http/, "ws");
const GRACE_MS = Number(process.env.HOST_HANDOFF_GRACE_MS || 1500);

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push({ name, ok, actual, expected });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (got ${actual}, want ${expected})`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createSession() {
  const res = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Host handoff check",
      items: [
        { title: "Alpha", mediaType: "image" },
        { title: "Beta", mediaType: "image" },
      ],
    }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(`create failed: ${JSON.stringify(payload)}`);
  return payload.slug;
}

async function joinSession(slug, participantId, displayName) {
  const res = await fetch(`${base}/api/sessions/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, displayName }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(`join failed: ${JSON.stringify(payload)}`);
  return payload.participantToken;
}

function connect(slug, participantId, token, displayName) {
  const ws = new WebSocket(
    `${wsBase}/ws?slug=${slug}&participantId=${encodeURIComponent(participantId)}&displayName=${displayName}`,
  );
  const state = { ws, host: undefined, authed: false, participantId };

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "room-state") state.host = msg.hostParticipantId ?? null;
    if (msg.type === "auth-ok") state.authed = true;
    if (msg.type === "auth-denied") state.authed = false;
  });

  return new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", participantId, participantToken: token }));
      const deadline = Date.now() + 5000;
      const poll = setInterval(() => {
        if (state.authed) {
          clearInterval(poll);
          resolve(state);
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error(`auth timed out for ${participantId}`));
        }
      }, 50);
    });
  });
}

const slug = await createSession();
console.log(`room ${slug}\n`);

// 1. Solo player becomes host on auth.
const aId = "check-a";
const aToken = await joinSession(slug, aId, "Player A");
let a = await connect(slug, aId, aToken, "A");
await sleep(300);
check("solo player becomes host", a.host, aId);

// 2. Second player joins; host does not move.
const bId = "check-b";
const bToken = await joinSession(slug, bId, "Player B");
const b = await connect(slug, bId, bToken, "B");
await sleep(300);
check("host unchanged when a second player joins", b.host, aId);

// 3. Host drops briefly and returns inside the grace window: keeps the role.
a.ws.close();
await sleep(Math.max(200, GRACE_MS / 3));
a = await connect(slug, aId, aToken, "A");
await sleep(GRACE_MS + 800);
check("host survives a reconnect inside the grace window", b.host, aId);

// 4. Host leaves for good: the remaining player is promoted.
a.ws.close();
await sleep(GRACE_MS + 1200);
check("host hands off after the grace window", b.host, bId);

// 5. Old host returns: it does not steal the role back.
const aAgain = await connect(slug, aId, aToken, "A");
await sleep(600);
check("returning old host does not reclaim the role", aAgain.host, bId);

// 6. The reported bug: room emptied with a stale host id, then one new player
//    arrives with a different participant id.
aAgain.ws.close();
b.ws.close();
await sleep(500);
const cId = "check-c";
const cToken = await joinSession(slug, cId, "Player C");
const c = await connect(slug, cId, cToken, "C");
await sleep(GRACE_MS + 1200);
check("lone newcomer inherits a stale host id", c.host, cId);

c.ws.close();
await sleep(200);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
