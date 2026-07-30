import WebSocket from "ws";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node qa/ws-diagnostic.mjs <slug>");
  process.exit(1);
}

function client(id, name) {
  const ws = new WebSocket(`ws://localhost:3000/ws?slug=${slug}`);
  ws.on("open", () => {
    console.log(`[${id}] open`);
    ws.send(JSON.stringify({ type: "join", slug, participantId: id, displayName: name }));
  });
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "room-state") {
        console.log(`[${id}] room-state clients=${(msg.clients || []).length} ids=${(msg.clients || []).map((c) => c.id).join(",")} status=${msg.roomStatus}`);
      } else {
        console.log(`[${id}] ${msg.type}`);
      }
    } catch {
      console.log(`[${id}] raw`, raw.toString());
    }
  });
  ws.on("close", () => console.log(`[${id}] close`));
  ws.on("error", (e) => console.log(`[${id}] error`, e.message));
  return ws;
}

const c1 = client("diag-host", "Diag Host");
setTimeout(() => {
  const c2 = client("diag-friend", "Diag Friend");
  setTimeout(() => {
    c1.close();
    c2.close();
  }, 2000);
}, 300);
