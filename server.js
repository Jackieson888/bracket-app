const http = require("http");
const next = require("next");
const { attachWsRuntime } = require("./realtime-runtime/ws-runtime");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    handle(req, res);
  });
  const handleUpgrade = app.getUpgradeHandler();
  attachWsRuntime(server, {
    onUnknownUpgrade(req, socket, head) {
      handleUpgrade(req, socket, head);
    },
  });

  server.listen(port, hostname, () => {
    console.log(
      `> Ready on http://localhost:${port} (bound to ${hostname}:${port})`,
    );
  });
});
