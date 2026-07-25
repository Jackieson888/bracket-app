import clientPromise from "@/lib/mongodb";
import { NextRequest } from "next/server";

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
  const client = await clientPromise;
  const db = client.db("test");
  const brackets = db.collection("brackets");

  const { id } = await params;

  const result = await brackets.findOne({ _id: id });

  return Response.json(result);
}
