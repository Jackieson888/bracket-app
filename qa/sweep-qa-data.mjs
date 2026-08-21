// Sweeps QA leftovers out of the database.
//
//   node qa/sweep-qa-data.mjs            # dry run: counts only
//   node qa/sweep-qa-data.mjs --delete   # actually delete
//
// run-qa.mjs already deletes everything a run creates, tracked by id. This is
// for the cases that escape it: a run killed part way through, the one-off
// probe scripts, and game results recorded by an abandoned room after its
// session document had already been swept (those come out with no bracketId
// and no bracketTitle, so nothing in the app can ever read them).
import { MongoClient } from "mongodb";
import { loadEnvLocal } from "./lib/harness.mjs";

const uri = process.env.MONGODB_URI || loadEnvLocal().MONGODB_URI;
if (!uri) {
  console.error("No MONGODB_URI in the environment or .env.local");
  process.exit(1);
}

const commit = process.argv.includes("--delete");
const client = await new MongoClient(uri).connect();
const db = client.db("prod");

const qaTitle = { $regex: "^QA " };
const qaSessions = await db
  .collection("sessions")
  .find({ "bracket.title": qaTitle })
  .project({ slug: 1 })
  .toArray();
const slugs = qaSessions.map((doc) => doc.slug);

const targets = [
  ["sessions", { "bracket.title": qaTitle }],
  ["brackets", { title: qaTitle }],
  ["gameResults", { bracketTitle: qaTitle }],
  ...(slugs.length ? [["gameResults", { slug: { $in: slugs } }]] : []),
  ["gameResults", { bracketTitle: null, bracketId: null }],
];

for (const [collection, filter] of targets) {
  const count = await db.collection(collection).countDocuments(filter);
  if (!count) continue;

  if (commit) {
    const result = await db.collection(collection).deleteMany(filter);
    console.log(`deleted ${result.deletedCount} from ${collection}: ${JSON.stringify(filter)}`);
  } else {
    console.log(`would delete ${count} from ${collection}: ${JSON.stringify(filter)}`);
  }
}

if (!commit) {
  console.log("\nDry run. Pass --delete to remove them.");
}

await client.close();
