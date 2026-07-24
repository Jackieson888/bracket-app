import clientPromise from "@/lib/mongodb";
import { auth0 } from "@/lib/auth0";

export async function POST(req: Request) {
  try {
    const session = await auth0.getSession();
    const body = await req.json();

    const client = await clientPromise;
    const db = client.db("test");
    const brackets = db.collection("brackets");

    const user = session?.user ?? { guest: true };

    const doc = {
      title: body.title,
      items: body.items,
      user: user,
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

    const results = await brackets.find();

    return Response.json({ success: true, brackets: results });
  } catch (err) {
    console.error("Error getting bracket:", err);
    return Response.json(
      { error: "Failed to fetch brackets" },
      { status: 500 },
    );
  }
}
