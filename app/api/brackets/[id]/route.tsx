import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { toPublicUser } from "@/lib/user";

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

    if (!ObjectId.isValid(id)) {
      return Response.json({ error: "Invalid bracket id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("test");
    const brackets = db.collection("brackets");

    const result = await brackets.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return Response.json({ error: "Bracket not found" }, { status: 404 });
    }

    return Response.json({
      ...result,
      user: toPublicUser(result.user && !result.user.guest ? result.user : null),
    });
  } catch (err) {
    console.error("Error getting bracket:", err);
    return Response.json(
      { error: "Failed to fetch bracket" },
      { status: 500 },
    );
  }
}
