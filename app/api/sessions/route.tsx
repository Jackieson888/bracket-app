import clientPromise from "@/lib/mongodb";
import { auth0 } from "@/lib/auth0";
import generateSlug from "@/lib/slug";
import { checkRateLimit, clientKey, rateLimitResponse } from "@/lib/rate-limit";

const SESSION_TTL_MS = 30 * 60 * 1000;

const MAX_ITEMS = 64;
const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const SLUG_ATTEMPTS = 5;

const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 60_000;

type IncomingItem = Record<string, unknown>;

function asBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Only http(s) urls are stored. Without this a bracket could carry a
// javascript: or data: url that later gets rendered as media.
function asMediaUrl(value: unknown): string | undefined {
  const raw = asBoundedString(value, MAX_URL_LENGTH);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? raw
      : undefined;
  } catch {
    return undefined;
  }
}

// The request body used to be written to the session document as-is, which
// meant an arbitrary client-supplied object (up to Mongo's 16MB per-document
// ceiling) was persisted and later replayed to every player in the room. Build
// the stored bracket from a field whitelist instead.
function sanitizeBracket(body: unknown) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const source = body as Record<string, unknown>;
  const rawItems = Array.isArray(source.items) ? source.items : [];

  const items = rawItems
    .slice(0, MAX_ITEMS)
    .map((entry: IncomingItem) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const title = asBoundedString(entry.title, MAX_TITLE_LENGTH);
      if (!title) {
        return null;
      }

      const mediaType = entry.mediaType === "video" ? "video" : "image";

      return {
        id: asBoundedString(entry.id, 100) ?? crypto.randomUUID(),
        title,
        url: asMediaUrl(entry.url),
        width: asFiniteNumber(entry.width),
        height: asFiniteNumber(entry.height),
        mediaType,
        duration: asFiniteNumber(entry.duration) ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (items.length === 0) {
    return null;
  }

  return {
    _id: asBoundedString(source._id, 100) ?? null,
    title: asBoundedString(source.title, MAX_TITLE_LENGTH) ?? "Untitled bracket",
    items,
  };
}

let indexesEnsured = false;

async function ensureSessionIndexes(
  sessions: import("mongodb").Collection,
): Promise<void> {
  if (indexesEnsured) {
    return;
  }
  indexesEnsured = true;

  try {
    await sessions.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: "sessionExpiresAt" },
    );
    // Makes the retry loop below meaningful: without this two rooms could hold
    // the same code and findOne({ slug }) would return an arbitrary one.
    await sessions.createIndex({ slug: 1 }, { unique: true, name: "sessionSlug" });
  } catch (err) {
    // Most likely pre-existing duplicate slugs blocking the unique index.
    // Don't take the route down over it - log and continue.
    indexesEnsured = false;
    console.error("Failed to ensure session indexes:", err);
  }
}

export async function POST(req: Request) {
  try {
    const limit = checkRateLimit(
      clientKey(req, "session-create"),
      CREATE_LIMIT,
      CREATE_WINDOW_MS,
    );
    if (!limit.ok) {
      return rateLimitResponse(limit.retryAfterSeconds);
    }

    const session = await auth0.getSession();
    const body = await req.json().catch(() => null);
    const bracket = sanitizeBracket(body);

    if (!bracket) {
      return Response.json(
        { error: "A bracket with at least one titled item is required." },
        { status: 400 },
      );
    }

    const client = await clientPromise;
    const db = client.db("test");
    const sessions = db.collection("sessions");

    await ensureSessionIndexes(sessions);

    const hostParticipant = session?.user?.sub
      ? {
          participantId: session.user.sub,
          displayName:
            session.user.name ||
            session.user.nickname ||
            session.user.email ||
            "Host",
          joinedAt: new Date(),
          lastSeenAt: new Date(),
        }
      : null;

    const buildDoc = (slug: string) => ({
      slug,
      bracket,
      hostUserId: session?.user?.sub ?? null,
      joinedUserIds: [session?.user?.sub].filter(Boolean),
      participantLookup: hostParticipant
        ? { [hostParticipant.participantId]: hostParticipant }
        : {},
      participantIds: [session?.user?.sub].filter(Boolean),
      joinedParticipants: hostParticipant ? [hostParticipant] : [],
      roomStatus: "waiting",
      gameStateVersion: 0,
      roomSnapshotVersion: 0,
      sessionTtlMs: SESSION_TTL_MS,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      gameState: {
        round: 0,
        currentMatch: 0,
        matchSize: 2,
        currentRoundItems: [],
        votesByMatch: {},
        pendingVoteCount: 0,
        roundWinners: [],
        winner: null,
      },
    });

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      const slug = generateSlug();

      try {
        const result = await sessions.insertOne(buildDoc(slug));
        return Response.json({ slug, sessionId: result.insertedId });
      } catch (err) {
        // 11000 is a duplicate key - that code is already live, so draw again.
        if ((err as { code?: number })?.code === 11000) {
          continue;
        }
        throw err;
      }
    }

    return Response.json(
      { error: "Could not allocate a room code. Please try again." },
      { status: 503 },
    );
  } catch (err) {
    console.error("Error creating session:", err);
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
