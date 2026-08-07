export type GameResultItemStat = {
  itemId: string;
  title: string;
  wins: number;
  losses: number;
  roundReached: number;
  isWinner: boolean;
};

export type GameResultMatchLogEntry = {
  round: number;
  match: number;
  items: Array<{ id: string; title: string }>;
  voteCounts: Record<string, number>;
  winnerItemId: string;
  wasBye: boolean;
};

export type GameResultParticipantPick = {
  authUserId: string;
  round: number;
  match: number;
  pickedItemId: string;
  wasMatchWinner: boolean;
};

export type GameResultDoc = {
  slug?: string;
  bracketId: string | null;
  bracketTitle: string | null;
  hostUserId?: string | null;
  participantUserIds?: string[];
  guestParticipantCount?: number;
  winnerItemId?: string;
  winnerItemTitle?: string | null;
  itemResults?: GameResultItemStat[];
  matchLog?: GameResultMatchLogEntry[];
  participantPicks?: GameResultParticipantPick[];
  roundCount?: number;
  startedAt?: Date | string;
  completedAt?: Date | string;
};

export type BracketStatsSummary = {
  totalPlays: number;
  itemStats: Array<{
    itemId: string;
    title: string;
    wins: number;
    losses: number;
    playRate: number;
  }>;
  closestMatch: {
    round: number;
    match: number;
    itemIds: string[];
    voteCounts: Record<string, number>;
    winnerItemId: string;
  } | null;
  lastPlayedAt: string | null;
};

// Reduces raw `gameResults` documents for one bracket into the summary shape
// both /api/brackets (list) and /api/brackets/[id]/stats serve. Plain-JS
// reduction rather than a Mongo aggregation pipeline, matching the rest of
// this codebase (nothing else here uses one) and this app's small scale.
export function summarizeGameResults(docs: GameResultDoc[]): BracketStatsSummary {
  const itemStatsMap = new Map<
    string,
    { itemId: string; title: string; wins: number; losses: number }
  >();
  let closestMatch: BracketStatsSummary["closestMatch"] = null;
  let closestMargin = Infinity;
  let lastPlayedAt: Date | null = null;

  for (const doc of docs) {
    if (doc.completedAt) {
      const completedAt = new Date(doc.completedAt);
      if (!lastPlayedAt || completedAt > lastPlayedAt) {
        lastPlayedAt = completedAt;
      }
    }

    for (const item of doc.itemResults ?? []) {
      const existing = itemStatsMap.get(item.itemId) ?? {
        itemId: item.itemId,
        title: item.title,
        wins: 0,
        losses: 0,
      };
      existing.wins += item.wins ?? 0;
      existing.losses += item.losses ?? 0;
      existing.title = item.title ?? existing.title;
      itemStatsMap.set(item.itemId, existing);
    }

    for (const match of doc.matchLog ?? []) {
      if (match.wasBye) {
        continue;
      }

      const counts = Object.values(match.voteCounts ?? {});
      if (counts.length < 2) {
        continue;
      }

      const sorted = [...counts].sort((a, b) => b - a);
      const margin = sorted[0] - sorted[1];
      if (margin < closestMargin) {
        closestMargin = margin;
        closestMatch = {
          round: match.round,
          match: match.match,
          itemIds: (match.items ?? []).map((item) => item.id),
          voteCounts: match.voteCounts,
          winnerItemId: match.winnerItemId,
        };
      }
    }
  }

  const totalPlays = docs.length;
  const itemStats = Array.from(itemStatsMap.values())
    .map((stat) => ({
      ...stat,
      playRate: totalPlays > 0 ? stat.wins / totalPlays : 0,
    }))
    .sort((a, b) => b.wins - a.wins);

  return {
    totalPlays,
    itemStats,
    closestMatch,
    lastPlayedAt: lastPlayedAt ? lastPlayedAt.toISOString() : null,
  };
}
