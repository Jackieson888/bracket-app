import clientPromise from "@/lib/mongodb";

export async function GET(_req, { params }) {
  const client = await clientPromise;
  const db = client.db("test");
  const brackets = db.collection("brackets");

  const { id } = await params;

  const result = await brackets.findOne({ _id: id });

  return Response.json(result);
}
