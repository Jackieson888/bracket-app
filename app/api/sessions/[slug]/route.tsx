import clientPromise from "@/lib/mongodb";

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

interface Params {
  slug: string;
}

interface RouteContext {
  params: Promise<Params>;
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

    return Response.json(result);
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

    const updateResult = await sessions.updateOne(
      { slug },
      {
        $set: {
          [`participantLookup.${participantId}`]: {
            participantId,
            displayName,
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

    const updated = await sessions.findOne(
      { slug },
      { projection: { participantLookup: 1, slug: 1, _id: 1 } },
    );

    const participants = Object.values(updated?.participantLookup ?? {});

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
