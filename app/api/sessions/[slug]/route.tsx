import clientPromise from "@/lib/mongodb";
import { toPublicUser, toPublicParticipant, type ParticipantRecord } from "@/lib/user";
import { auth0 } from "@/lib/auth0";

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

const SESSION_TTL_MS = 30 * 60 * 1000;

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
    const client = await clientPromise;
    const db = client.db("test");
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

    const { hostUserId: _hostUserId, joinedUserIds: _joinedUserIds, ...safeResult } = result;
    const bracket =
      safeResult.bracket && typeof safeResult.bracket === "object"
        ? {
            ...safeResult.bracket,
            user: toPublicUser(
              safeResult.bracket.user && !safeResult.bracket.user.guest
                ? safeResult.bracket.user
                : null,
            ),
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

    const client = await clientPromise;
    const db = client.db("test");
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

    if (existingSession.roomStatus === "started" && !isKnownParticipant) {
      return Response.json(
        {
          error:
            "This game has already started. You can no longer join.",
        },
        { status: 409 },
      );
    }

    const updateResult = await sessions.updateOne(
      { slug },
      {
        $set: {
          [`participantLookup.${participantId}`]: {
            participantId,
            displayName,
            authUserId,
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
      participants,
    });
  } catch (err) {
    console.error("Error joining session:", err);
    return Response.json({ error: "Failed to join session" }, { status: 500 });
  }
}
