import clientPromise from "@/lib/mongodb";

export async function GET({ params }) {
  const client = await clientPromise;
  const db = client.db("test");
  const sessions = db.collection("sessions");

  const { slug } = params;

  const result = await sessions.find({ slug: slug });

  return Response.json({ result });
}
