import WebSocket from "ws";

const slug = process.argv[2] || "XL4ZT";
const base = process.argv[3] || "wss://ws.tvt-game.app";

const ws = new WebSocket(`${base}/ws?slug=${slug}&participantId=probe-1&displayName=Probe`);

ws.on("open", () => {
  console.log("open");
  ws.send(JSON.stringify({ type: "join", slug, participantId: "probe-1", displayName: "Probe" }));
  // Does this deployment implement the token-auth handshake at all?
  setTimeout(
    () =>
      ws.send(
        JSON.stringify({
          type: "auth",
          participantId: "probe-1",
          participantToken: "not-a-real-token",
        }),
      ),
    500,
  );
});
ws.on("message", (raw) => console.log("<-", raw.toString().slice(0, 400)));
ws.on("error", (e) => console.log("error", e.message));
ws.on("close", (c) => console.log("close", c));

setTimeout(() => ws.close(), 4000);
