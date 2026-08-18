import QRCode from "qrcode";
import { NextRequest } from "next/server";
import { checkRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

const QR_LIMIT = 30;
const QR_WINDOW_MS = 60_000;

// Renders the join URL for a room as an SVG. Generated server-side so the
// lobby does not have to ship a QR encoder to every phone, and cached because
// the image for a given room code never changes.
export async function GET(
  req: NextRequest,
  { params }: RouteContext,
): Promise<Response> {
  const limit = checkRateLimit(clientKey(req, "qr"), QR_LIMIT, QR_WINDOW_MS);
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }

  const { slug } = await params;

  // The code goes straight into the encoded URL, so keep it to the shape
  // generateSlug produces.
  if (!/^[A-Z0-9]{4,8}$/.test(slug)) {
    return Response.json({ error: "Invalid room code" }, { status: 400 });
  }

  const joinUrl = `${req.nextUrl.origin}/play/${slug}`;

  const svg = await QRCode.toString(joinUrl, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
