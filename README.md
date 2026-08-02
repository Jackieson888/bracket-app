This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Realtime Runtime (WebSocket)

This repository now has two runtime modes:

- Local combined runtime: [server.js](server.js) runs Next.js plus `/ws` together for local development.
- Production websocket runtime: [realtime-runtime/server.js](realtime-runtime/server.js) runs only the realtime socket service for EC2.

This split is intentional. The websocket server used to live inside the main app runtime, which meant an EC2 host had to carry the full Next.js dependency and build surface even when it only needed to serve long-lived websocket connections. The current layout keeps the app host and the realtime host separate so production can run the lightest possible websocket process.

Recommended production shape:

- Amplify hosts the Next.js app and API routes.
- EC2 hosts only the lightweight websocket runtime.

Runtime ownership:

- [server.js](server.js): local combined entrypoint for Next.js HTTP handling plus websocket upgrades.
- [ws-server.js](ws-server.js): compatibility entrypoint for running only the websocket runtime from the repo root.
- [realtime-runtime/server.js](realtime-runtime/server.js): standalone HTTP plus websocket server for EC2.
- [realtime-runtime/ws-runtime.js](realtime-runtime/ws-runtime.js): shared room lifecycle, TTL expiration, vote routing, reconnect hydration, and persistence logic.
- [realtime-runtime/package.json](realtime-runtime/package.json): minimal production dependency set for the standalone runtime.

Useful commands:

- Local combined dev: `npm run dev`
- Local websocket-only dev: `npm run dev:ws`
- Standalone websocket runtime: `npm run start:ws`
- Next.js build for Amplify/app hosting: `npm run build`

How to use those commands:

- Use `npm run dev` when you want the local app and websocket runtime on the same port.
- Use `npm run dev:ws` when you only want to boot the socket runtime for focused realtime testing.
- Use `npm run build` only for the Next.js app host. The EC2 websocket host does not need a Next.js build.

Important: the production websocket runtime must run as a long-lived Node process (or container). If you deploy to a serverless-only target, websocket upgrades will not stay alive.

What the lightweight runtime is responsible for:

- accepting `/ws` upgrades
- keeping active rooms in memory
- loading and persisting room snapshots in MongoDB
- enforcing room expiration with `SESSION_TTL_MS`
- cleaning up idle in-memory rooms with `ROOM_IDLE_TTL_MS`
- broadcasting room state and vote updates to connected players

What it is not responsible for:

- rendering the Next.js UI
- hosting the main application pages in production
- running a Next.js build on the EC2 websocket host
- replacing your API routes or Amplify-hosted frontend

### Phase 3: Deploy The Realtime Runtime To EC2

Before you run the bootstrap, create a production env file for the websocket runtime.

1. Copy `realtime-runtime/.env.production.example` to `realtime-runtime/.env.production`.
2. Fill in your production `MONGODB_URI`.
3. Adjust `SESSION_TTL_MS` or `ROOM_IDLE_TTL_MS` only if you want different expiration behavior.

Then run the EC2 bootstrap from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-ec2-ws.ps1 \
   -Host "your-ec2-public-dns" \
   -KeyPath "C:\path\to\your-key.pem" \
   -RepoUrl "https://github.com/your-org/your-repo.git" \
   -Branch "main" \
   -LocalEnvFile ".\realtime-runtime\.env.production"
```

What the script now does:

- uploads your runtime env file to the instance
- clones the repo if missing, or pulls the selected branch if it already exists
- installs only `realtime-runtime` dependencies
- writes `/etc/tvt-game-ws.env` for systemd
- restarts `tvt-game-ws`
- verifies `http://127.0.0.1:3000/health`

If the service starts cleanly, your Phase 3 exit criteria are:

- `systemctl status tvt-game-ws` shows the service as active
- `curl http://127.0.0.1:3000/health` returns `{\"ok\":true}` on the instance
- `journalctl -u tvt-game-ws -n 200 --no-pager` shows no startup errors

Environment variables used by the standalone runtime:

- `MONGODB_URI`: required for room persistence and reconnect hydration across process restarts.
- `SESSION_TTL_MS`: optional session lifetime in milliseconds. Defaults to 30 minutes.
- `ROOM_IDLE_TTL_MS`: optional in-memory cleanup window after all clients disconnect. Defaults to 5 minutes.
- `PORT`: optional listen port for the runtime. Defaults to `3000`.

### EC2 One-Shot Bootstrap Scripts

From the project root, run:

1. Websocket runtime + systemd service (`realtime-runtime/server.js`):
   - `powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-ec2-ws.ps1`
2. Nginx reverse proxy (`/` + `/ws`) and optional TLS:
   - HTTP only: `powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-ec2-nginx-tls.ps1`
   - HTTPS/TLS: `powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-ec2-nginx-tls.ps1 -EnableTls -CertEmail "you@example.com"`

The EC2 websocket bootstrap now installs only the [realtime-runtime/package.json](realtime-runtime/package.json) dependencies and does not build Next.js on the instance.

That is the key production change in this refactor: EC2 is now responsible only for the lightweight realtime process, while Amplify continues to own the main app deploy.

After TLS is active, set `NEXT_PUBLIC_WS_URL` in your frontend environment to your public websocket host, for example:

- `NEXT_PUBLIC_WS_URL=wss://your-domain.com`
- `NEXT_PUBLIC_WS_URL=wss://ec2-44-251-123-224.us-west-2.compute.amazonaws.com` (if cert is valid for that host)

By default, each play-created session lives for 30 minutes from the moment it is created and the websocket room will expire automatically after that window.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
