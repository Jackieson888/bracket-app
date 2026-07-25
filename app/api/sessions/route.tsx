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
    createdAt: new Date(),
  };

  const result = await sessions.insertOne(doc);

  return Response.json({ slug, sessionId: result.insertedId });
}
