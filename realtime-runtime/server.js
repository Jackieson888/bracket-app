const http = require("http");

const { attachWsRuntime } = require("./ws-runtime");

const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("TVT websocket runtime online\n");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found\n");
});

attachWsRuntime(server);

server.listen(port, hostname, () => {
  console.log(
    `> WebSocket runtime ready on http://localhost:${port} (bound to ${hostname}:${port})`,
  );
});
