import clientPromise from "@/lib/mongodb";
import { NextRequest } from "next/server";
import { summarizeGameResults, type GameResultDoc } from "@/lib/game-results";

interface Params {
  id: string;
}

interface RouteContext {
  params: Promise<Params>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteContext,
): Promise<Response> {
  try {
    const { id } = await params;

    const client = await clientPromise;
    const db = client.db("prod");
    const gameResults = db.collection("gameResults");

    const docs = (await gameResults
      .find({ bracketId: id })
      .toArray()) as unknown as GameResultDoc[];

    return Response.json({ bracketId: id, ...summarizeGameResults(docs) });
  } catch (err) {
    console.error("Error getting bracket stats:", err);
    return Response.json(
      { error: "Failed to fetch bracket stats" },
      { status: 500 },
    );
  }
}
