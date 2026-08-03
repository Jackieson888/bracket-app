import clientPromise from "@/lib/mongodb";
import { auth0 } from "@/lib/auth0";
import { toPublicUser } from "@/lib/user";

const MAX_BRACKETS_RETURNED = 5;

export async function POST(req: Request) {
  try {
    const session = await auth0.getSession();
    const body = await req.json();

    const client = await clientPromise;
    const db = client.db("test");
    const brackets = db.collection("brackets");

    const doc = {
      title: body.title,
      items: body.items,
      user: toPublicUser(session?.user ?? null),
      createdAt: new Date(),
    };

    const result = await brackets.insertOne(doc);

    return Response.json({ success: true, id: result.insertedId });
  } catch (err) {
    console.error("Error saving bracket:", err);
    return Response.json({ error: "Failed to save bracket" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("test");
    const brackets = db.collection("brackets");

    const query = req.url.includes("?") ? new URL(req.url).searchParams : null;

    const search = query?.get("search") ?? "";
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const results = await brackets
      .find(
        escapedSearch
          ? { title: { $regex: escapedSearch, $options: "i" } }
          : {},
      )
      .sort({ createdAt: -1 })
      .limit(MAX_BRACKETS_RETURNED)
      .toArray();

    const sanitized = results.map((bracket) => ({
      ...bracket,
      user: toPublicUser(
        bracket.user && !bracket.user.guest ? bracket.user : null,
      ),
    }));

    return Response.json({ success: true, brackets: sanitized });
  } catch (err) {
    console.error("Error getting bracket:", err);
    return Response.json(
      { error: "Failed to fetch brackets" },
      { status: 500 },
    );
  }
}
