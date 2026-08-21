// QA suite entry point.
//
//   npm run dev                      (in another terminal)
//   node qa/run-qa.mjs
//
// Useful flags:
//   --only=solo-game,host-handoff    run just these scenarios
//   --skip-slow                      drop scenarios that wait out a grace period
//   --keep-data                      leave the brackets/sessions the run created
//   --out=qa/output/run.json         where the JSON report goes
//
// The suite talks to a real server and therefore a real database. Everything
// it creates is tracked and deleted at the end unless --keep-data is passed,
// so a run leaves no QA brackets sitting on the play page.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import {
  allScenarios,
  api,
  config,
  loadEnvLocal,
  repoRoot,
  settleAbandonedRooms,
  sleep,
} from "./lib/harness.mjs";

import "./scenarios/create-and-solo.mjs";
import "./scenarios/lobby-and-voting.mjs";
import "./scenarios/resilience-and-identity.mjs";
import "./scenarios/timers-and-expiry.mjs";
import "./scenarios/history-and-stats.mjs";
import "./scenarios/board-visuals.mjs";
import "./scenarios/browser-identity.mjs";
import "./scenarios/five-player-room.mjs";
import "./scenarios/loop-integrity.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.some((arg) => arg === `--${name}`);
const value = (name) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const only = value("only")
  ? new Set(value("only").split(",").map((entry) => entry.trim()))
  : null;
const skipSlow = flag("skip-slow");
const keepData = flag("keep-data");
const outPath = path.resolve(
  repoRoot,
  value("out") ||
    `qa/output/qa-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

const report = {
  startedAt: new Date().toISOString(),
  baseUrl: config.baseUrl,
  scenarios: [],
  totals: { passed: 0, failed: 0, skipped: 0 },
};

const created = { bracketIds: new Set(), slugs: new Set() };
const shared = new Map();

async function connectMongo() {
  const uri = process.env.MONGODB_URI || loadEnvLocal().MONGODB_URI;
  if (!uri) return null;
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    return client;
  } catch (error) {
    console.warn(`! Mongo unavailable, skipping direct DB checks: ${error.message}`);
    return null;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const res = await api("/api/brackets");
      if (res.status < 500) return true;
    } catch {
      // Not listening yet.
    }
    await sleep(1000);
  }
  return false;
}

function makeContext(mongo, entry) {
  const players = [];
  return {
    mongo,
    players,
    baseUrl: config.baseUrl,
    check(name, condition, detail) {
      const pass = Boolean(condition);
      entry.checks.push({ name, pass, detail: pass ? undefined : detail });
      if (pass) report.totals.passed += 1;
      else report.totals.failed += 1;
      console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `\n        ${detail}`}`);
    },
    skip(name, why) {
      entry.checks.push({ name, skipped: true, detail: why });
      report.totals.skipped += 1;
      console.log(`  SKIP  ${name} (${why})`);
    },
    metric(key, val) {
      entry.metrics[key] = val;
    },
    remember(key, val) {
      shared.set(key, val);
    },
    recall(key) {
      return shared.get(key);
    },
    trackBracket(id) {
      created.bracketIds.add(String(id));
    },
    trackSession(slug) {
      created.slugs.add(slug);
    },
    cleanupPlayer(player) {
      players.push(player);
    },
  };
}

async function cleanup(mongo) {
  if (keepData) {
    console.log(
      `\nLeaving ${created.bracketIds.size} bracket(s) and ${created.slugs.size} session(s) in place (--keep-data).`,
    );
    return { skipped: true };
  }
  if (!mongo) {
    console.warn(
      "\n! No Mongo connection - QA brackets and sessions were left behind.",
    );
    return { skipped: true, reason: "no mongo connection" };
  }

  const db = mongo.db("prod");
  const { ObjectId } = await import("mongodb");
  const bracketIds = Array.from(created.bracketIds)
    .map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const slugs = Array.from(created.slugs);

  const removed = {
    brackets: bracketIds.length
      ? (await db.collection("brackets").deleteMany({ _id: { $in: bracketIds } }))
          .deletedCount
      : 0,
    sessions: slugs.length
      ? (await db.collection("sessions").deleteMany({ slug: { $in: slugs } }))
          .deletedCount
      : 0,
    gameResults: slugs.length
      ? (await db.collection("gameResults").deleteMany({ slug: { $in: slugs } }))
          .deletedCount
      : 0,
  };
  console.log(
    `\nCleanup: removed ${removed.brackets} bracket(s), ${removed.sessions} session(s), ${removed.gameResults} game result(s).`,
  );
  return { ...removed, slugs, bracketIds: Array.from(created.bracketIds) };
}

async function main() {
  console.log(`QA suite against ${config.baseUrl}\n`);

  if (!(await waitForServer())) {
    throw new Error(
      `No server answered at ${config.baseUrl}. Start it with "npm run dev" first.`,
    );
  }

  const mongo = await connectMongo();
  const scenarios = allScenarios().filter((entry) => {
    if (only && !only.has(entry.name)) return false;
    if (skipSlow && entry.slow) return false;
    return true;
  });

  for (const definition of scenarios) {
    const entry = {
      name: definition.name,
      covers: definition.covers,
      checks: [],
      metrics: {},
      startedAt: new Date().toISOString(),
    };
    report.scenarios.push(entry);
    console.log(`\n> ${definition.name} - ${definition.covers}`);

    const context = makeContext(mongo, entry);
    const startedAt = Date.now();
    try {
      await definition.run(context);
    } catch (error) {
      entry.error = String(error?.stack || error);
      report.totals.failed += 1;
      entry.checks.push({
        name: `${definition.name}-completed`,
        pass: false,
        detail: String(error?.message || error),
      });
      console.log(`  FAIL  ${definition.name} threw\n        ${error?.message || error}`);
    } finally {
      // Run any game this scenario abandoned out to its end, so its result
      // document exists before the sweep rather than minutes after it.
      try {
        await settleAbandonedRooms(context.players);
      } catch (error) {
        console.warn(`  !     could not settle rooms: ${error.message}`);
      }
      context.players.forEach((player) => player.close());
      entry.durationMs = Date.now() - startedAt;
      // Give the runtime a beat to process the closes before the next scenario.
      await sleep(250);
    }
  }

  report.cleanup = await cleanup(mongo);
  await mongo?.close();

  report.finishedAt = new Date().toISOString();
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  const { passed, failed, skipped } = report.totals;
  console.log(
    `\n${failed === 0 ? "ALL GREEN" : "FAILURES"}: ${passed} passed, ${failed} failed, ${skipped} skipped`,
  );
  console.log(`Report: ${path.relative(repoRoot, outPath)}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
