import clientPromise from "@/lib/mongodb";
import { auth0 } from "@/lib/auth0";
import { toPublicUser } from "@/lib/user";
import { summarizeGameResults, type GameResultDoc } from "@/lib/game-results";

const MAX_BRACKETS_RETURNED = 5;

export async function POST(req: Request) {
  try {
    const session = await auth0.getSession();
    const body = await req.json();

    const client = await clientPromise;
    const db = client.db("prod");
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
    const db = client.db("prod");
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

    const bracketIds = results.map((bracket) => String(bracket._id));
    const statsByBracketId = new Map<string, GameResultDoc[]>();

    if (bracketIds.length > 0) {
      const gameResults = db.collection("gameResults");
      const statsDocs = (await gameResults
        .find({ bracketId: { $in: bracketIds } })
        .toArray()) as unknown as GameResultDoc[];

      for (const doc of statsDocs) {
        if (!doc.bracketId) continue;
        const existing = statsByBracketId.get(doc.bracketId) ?? [];
        existing.push(doc);
        statsByBracketId.set(doc.bracketId, existing);
      }
    }

    const sanitized = results.map((bracket) => {
      const docs = statsByBracketId.get(String(bracket._id));
      const summary = docs ? summarizeGameResults(docs) : null;

      return {
        ...bracket,
        user: toPublicUser(
          bracket.user && !bracket.user.guest ? bracket.user : null,
        ),
        stats: summary
          ? {
              playCount: summary.totalPlays,
              topItemTitle: summary.itemStats[0]?.title ?? null,
            }
          : undefined,
      };
    });

    return Response.json({ success: true, brackets: sanitized });
  } catch (err) {
    console.error("Error getting bracket:", err);
    return Response.json(
      { error: "Failed to fetch brackets" },
      { status: 500 },
    );
  }
}
