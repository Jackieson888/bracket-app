import { getDb } from "@/lib/mongodb";
import { auth0 } from "@/lib/auth0";
import type { GameResultDoc } from "@/lib/game-results";

// Bounded to recent games for cost/simplicity — gamesHosted/gamesPlayed
// below are exact full-collection counts, only the pick-derived stats
// (favoriteItem, pickAccuracy) are limited to this recency window.
const RECENT_GAMES_FOR_PICKS = 20;

export async function GET(): Promise<Response> {
  try {
    const session = await auth0.getSession();
    const userId = session?.user?.sub;

    if (!userId) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = await getDb();
    const gameResults = db.collection("gameResults");

    const [gamesHosted, gamesPlayed, recentGames] = await Promise.all([
      gameResults.countDocuments({ hostUserId: userId }),
      gameResults.countDocuments({ participantUserIds: userId }),
      gameResults
        .find({ participantUserIds: userId })
        .sort({ completedAt: -1 })
        .limit(RECENT_GAMES_FOR_PICKS)
        .toArray() as unknown as Promise<GameResultDoc[]>,
    ]);

    const pickCounts = new Map<
      string,
      { title: string; count: number; lastPickedAt: number }
    >();
    let totalPicks = 0;
    let winningPicks = 0;

    for (const doc of recentGames) {
      const completedAtMs = doc.completedAt
        ? new Date(doc.completedAt).getTime()
        : 0;

      for (const pick of doc.participantPicks ?? []) {
        if (pick.authUserId !== userId) {
          continue;
        }

        totalPicks += 1;
        if (pick.wasMatchWinner) {
          winningPicks += 1;
        }

        const itemTitle =
          doc.itemResults?.find((item) => item.itemId === pick.pickedItemId)
            ?.title ?? pick.pickedItemId;

        const existing = pickCounts.get(pick.pickedItemId) ?? {
          title: itemTitle,
          count: 0,
          lastPickedAt: 0,
        };
        existing.count += 1;
        existing.lastPickedAt = Math.max(existing.lastPickedAt, completedAtMs);
        pickCounts.set(pick.pickedItemId, existing);
      }
    }

    const favoriteItem =
      Array.from(pickCounts.values()).sort(
        (a, b) => b.count - a.count || b.lastPickedAt - a.lastPickedAt,
      )[0] ?? null;

    return Response.json({
      gamesHosted,
      gamesPlayed,
      favoriteItem: favoriteItem
        ? { title: favoriteItem.title, count: favoriteItem.count }
        : null,
      pickAccuracy: totalPicks > 0 ? winningPicks / totalPicks : null,
    });
  } catch (err) {
    console.error("Error getting profile stats:", err);
    return Response.json(
      { error: "Failed to fetch profile stats" },
      { status: 500 },
    );
  }
}
