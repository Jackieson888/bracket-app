This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Realtime Runtime (WebSocket)

This app uses a custom Node server in [server.js](server.js) for `/ws` upgrades.

- Development: `npm run dev`
- Production build: `npm run build`
- Production runtime: `npm run start`

Important: production must run as a long-lived Node process (or container). If you deploy to a serverless-only target, websocket upgrades will not stay alive.

### EC2 One-Shot Bootstrap Scripts

From the project root, run:

1. App runtime + systemd service (`server.js`):
   - `powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-ec2-ws.ps1`
2. Nginx reverse proxy (`/` + `/ws`) and optional TLS:
   - HTTP only: `powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-ec2-nginx-tls.ps1`
   - HTTPS/TLS: `powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-ec2-nginx-tls.ps1 -EnableTls -CertEmail "you@example.com"`

After TLS is active, set `NEXT_PUBLIC_WS_URL` in your frontend environment to your public websocket host, for example:

- `NEXT_PUBLIC_WS_URL=wss://your-domain.com`
- `NEXT_PUBLIC_WS_URL=wss://ec2-44-251-123-224.us-west-2.compute.amazonaws.com` (if cert is valid for that host)

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
