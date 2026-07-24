import clientPromise from "@/lib/mongodb";

export async function GET({ params }) {
  const client = await clientPromise;
  const db = client.db("test");
  const brackets = db.collection("brackets");

  const { id } = params;

  const result = await brackets.find({ _id: id });

  return Response.json({ result });
}
