import clientPromise from "@/lib/mongodb";

export async function GET(_req: Request, { params }) {
  try {
    const client = await clientPromise;
    const db = client.db("test");
    const sessions = db.collection("sessions");
    const { slug } = await params;
    const result = await sessions.findOne({ slug: slug });

    return Response.json(result);
  } catch (err) {
    console.error("Error getting session:", err);
    return Response.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}
