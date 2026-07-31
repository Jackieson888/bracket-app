import clientPromise from "@/lib/mongodb";
import { auth0 } from "@/lib/auth0";
import generateSlug from "@/lib/slug";

export async function POST(req: Request) {
  const session = await auth0.getSession();
  const body = await req.json(); // { bracketId }

  const client = await clientPromise;
  const db = client.db("test");
  const sessions = db.collection("sessions");

  const slug = generateSlug();

  const doc = {
    slug,
    bracket: body,
    hostUserId: session?.user?.sub ?? null,
    joinedUserIds: [session?.user?.sub].filter(Boolean),
    participantLookup: session?.user?.sub
      ? {
          [session.user.sub]: {
            participantId: session.user.sub,
            displayName:
              session.user.name ||
              session.user.nickname ||
              session.user.email ||
              "Host",
            joinedAt: new Date(),
            lastSeenAt: new Date(),
          },
        }
      : {},
    participantIds: [session?.user?.sub].filter(Boolean),
    joinedParticipants: session?.user?.sub
      ? [
          {
            participantId: session.user.sub,
            displayName:
              session.user.name ||
              session.user.nickname ||
              session.user.email ||
              "Host",
            joinedAt: new Date(),
            lastSeenAt: new Date(),
          },
        ]
      : [],
    roomStatus: "waiting",
    gameStateVersion: 0,
    roomSnapshotVersion: 0,
    gameState: {
      round: 0,
      currentMatch: 0,
      currentRoundItems: [],
      votesByMatch: {},
      pendingVoteCount: 0,
      roundWinners: [],
      winner: null,
    },
    createdAt: new Date(),
  };

  const result = await sessions.insertOne(doc);

  return Response.json({ slug, sessionId: result.insertedId });
}
