import { getDb } from "@/lib/mongodb";
import {
  toPublicUserOrGuest,
  toPublicParticipant,
  type ParticipantRecord,
} from "@/lib/user";
import { auth0 } from "@/lib/auth0";

import { NextRequest } from "next/server";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { checkRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";

const SESSION_TTL_MS = 30 * 60 * 1000;

// Room codes are short enough to be worth guessing, so cap how fast one
// client can probe them or churn joins.
const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_MS = 60_000;
const JOIN_LIMIT = 20;
const JOIN_WINDOW_MS = 60_000;

// participantId is public - it keys votesByMatch, which is broadcast to every
// client in the room, and it is returned by GET for the lobby roster. So it
// cannot double as the credential. This token is the credential: minted here,
// returned only to the joining client, never included in any broadcast or in
// toPublicParticipant's whitelist.
function mintParticipantToken() {
  return randomBytes(32).toString("hex");
}

function tokensMatch(stored: unknown, provided: unknown): boolean {
  if (typeof stored !== "string" || typeof provided !== "string") {
    return false;
  }

  const storedBuffer = Buffer.from(stored, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  if (storedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(storedBuffer, providedBuffer);
}

interface Params {
  slug: string;
}

interface RouteContext {
  params: Promise<Params>;
}

function isExpired(expiresAt: unknown, createdAt?: unknown) {
  const expiresAtMs = expiresAt
    ? new Date(expiresAt as string | number | Date).getTime()
    : Number.NaN;

  if (Number.isFinite(expiresAtMs)) {
    return expiresAtMs <= Date.now();
  }

  if (!createdAt) {
    return false;
  }

  const createdAtMs = new Date(createdAt as string | number | Date).getTime();
  return Number.isFinite(createdAtMs)
    ? createdAtMs + SESSION_TTL_MS <= Date.now()
    : false;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteContext,
): Promise<Response> {
  try {
    const limit = checkRateLimit(
      clientKey(_req, "session-lookup"),
      LOOKUP_LIMIT,
      LOOKUP_WINDOW_MS,
    );
    if (!limit.ok) {
      return rateLimitResponse(limit.retryAfterSeconds);
    }

    const db = await getDb();
    const sessions = db.collection("sessions");
    const { slug } = await params;
    const result = await sessions.findOne({ slug: slug });

    if (!result) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (isExpired(result.expiresAt, result.createdAt)) {
      await sessions.deleteOne({ slug });
      return Response.json({ error: "Session expired" }, { status: 404 });
    }

    const {
      hostUserId: _hostUserId,
      joinedUserIds: _joinedUserIds,
      // The creator's claim on the host role. Anyone can GET a room by its
      // code, so leaking this would make the role takeable by whoever asks.
      hostClaimToken: _hostClaimToken,
      ...safeResult
    } = result;
    const bracket =
      safeResult.bracket && typeof safeResult.bracket === "object"
        ? {
            ...safeResult.bracket,
            user: toPublicUserOrGuest(safeResult.bracket.user),
          }
        : safeResult.bracket;

    const participantLookup = safeResult.participantLookup
      ? Object.fromEntries(
          Object.entries(
            safeResult.participantLookup as Record<string, ParticipantRecord>,
          ).map(([participantId, entry]) => [
            participantId,
            toPublicParticipant(entry),
          ]),
        )
      : safeResult.participantLookup;

    return Response.json({ ...safeResult, bracket, participantLookup });
  } catch (err) {
    console.error("Error getting session:", err);
    return Response.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: RouteContext,
): Promise<Response> {
  try {
    const limit = checkRateLimit(
      clientKey(req, "session-join"),
      JOIN_LIMIT,
      JOIN_WINDOW_MS,
    );
    if (!limit.ok) {
      return rateLimitResponse(limit.retryAfterSeconds);
    }

    const body = await req.json().catch(() => ({}));
    const { slug } = await params;
    const authSession = await auth0.getSession();
    const authUserId = authSession?.user?.sub ?? null;

    const participantId =
      typeof body.participantId === "string" && body.participantId.trim()
        ? body.participantId.trim()
        : randomUUID();
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : "Guest";

    const db = await getDb();
    const sessions = db.collection("sessions");

    const now = new Date();

    const existingSession = await sessions.findOne(
      { slug },
      {
        projection: {
          expiresAt: 1,
          createdAt: 1,
          roomStatus: 1,
          participantIds: 1,
          participantLookup: 1,
          hostClaimToken: 1,
        },
      },
    );

    if (!existingSession) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (isExpired(existingSession.expiresAt, existingSession.createdAt)) {
      await sessions.deleteOne({ slug });
      return Response.json({ error: "Session expired" }, { status: 404 });
    }

    const isKnownParticipant = Array.isArray(existingSession.participantIds)
      ? existingSession.participantIds.includes(participantId)
      : false;

    const existingRecord = (
      existingSession.participantLookup as
        Record<string, { participantToken?: string }> | undefined
    )?.[participantId];
    const existingToken = existingRecord?.participantToken;

    // Reclaiming an identity that already has a credential requires presenting
    // it. Without this check anyone could read a participantId out of the
    // public GET response and take over that player's slot (and their vote).
    if (existingToken && !tokensMatch(existingToken, body.participantToken)) {
      return Response.json(
        { error: "This player slot belongs to another device." },
        { status: 403 },
      );
    }

    const participantToken = existingToken ?? mintParticipantToken();

    // The creator's browser presents the token it was handed when it made the
    // room, and the host role follows it to whichever participant slot they
    // are using. Deliberately reclaimable: if they refresh, or come back after
    // a handoff gave the role away, presenting it again puts them back in
    // charge of the room they set up.
    const claimsHost =
      typeof existingSession.hostClaimToken === "string" &&
      tokensMatch(existingSession.hostClaimToken, body.hostClaimToken);

    if (existingSession.roomStatus === "started" && !isKnownParticipant) {
      return Response.json(
        {
          error: "This game has already started. You can no longer join.",
        },
        { status: 409 },
      );
    }

    const updateResult = await sessions.updateOne(
      { slug },
      {
        $set: {
          // Not hostParticipantId: that field tracks who holds the role right
          // now and is owned by the realtime runtime, which rewrites it on
          // every room snapshot. This records who the creator *is*, which the
          // runtime reads and never writes.
          ...(claimsHost ? { hostClaimParticipantId: participantId } : {}),
          [`participantLookup.${participantId}`]: {
            participantId,
            displayName,
            authUserId,
            participantToken,
            lastSeenAt: now,
          },
        },
        $addToSet: {
          participantIds: participantId,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: false },
    );

    if (updateResult.matchedCount === 0) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const currentSession = await sessions.findOne(
      { slug },
      { projection: { expiresAt: 1, createdAt: 1 } },
    );
    if (
      currentSession &&
      isExpired(currentSession.expiresAt, currentSession.createdAt)
    ) {
      await sessions.deleteOne({ slug });
      return Response.json({ error: "Session expired" }, { status: 404 });
    }

    const updated = await sessions.findOne(
      { slug },
      { projection: { participantLookup: 1, slug: 1, _id: 1 } },
    );

    const participants = Object.values(
      (updated?.participantLookup ?? {}) as Record<string, ParticipantRecord>,
    ).map(toPublicParticipant);

    return Response.json({
      slug,
      participantId,
      participantToken,
      isHost: claimsHost,
      participants,
    });
  } catch (err) {
    console.error("Error joining session:", err);
    return Response.json({ error: "Failed to join session" }, { status: 500 });
  }
}
