"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Box, Typography, Stack, Container, Chip } from "@mui/material";
import GameItemCard from "./game-item-card";

type Item = ComponentProps<typeof GameItemCard>["item"];

type BracketGameProps = {
  bracket?: {
    items?: Item[];
  };
  slug?: string;
  session?: unknown;
  roomState?: {
    round?: number;
    currentMatch?: number;
    currentRoundItems?: Item[];
    votes?: Record<string, number>;
    pendingVoteCount?: number;
  };
  onVote?: (payload: { round: number; match: number; choice: number }) => void;
};

export default function BracketGame({
  bracket,
  slug,
  session,
  roomState,
  onVote,
}: BracketGameProps) {
  const [round, setRound] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [currentRoundItems, setCurrentRoundItems] = useState<Item[]>(
    () => bracket?.items ?? [],
  );
  const [voteSummary, setVoteSummary] = useState<string>("Waiting for votes");

  useEffect(() => {
    if (roomState?.currentRoundItems?.length) {
      setCurrentRoundItems(roomState.currentRoundItems);
    }
    if (typeof roomState?.round === "number") {
      setRound(roomState.round);
    }
    if (typeof roomState?.currentMatch === "number") {
      setCurrentMatch(roomState.currentMatch);
    }
  }, [roomState]);

  function buildNextRound(items: Item[]) {
    const winners: Item[] = [];

    for (let i = 0; i < items.length; i += 2) {
      const left = items[i];
      const right = items[i + 1];

      if (!right) {
        winners.push(left);
        continue;
      }

      winners.push(left);
    }

    return winners;
  }

  const handleVote = ({ index }: { item: Item; index: number }) => {
    if (!onVote) {
      return;
    }

    const votePayload = {
      round,
      match: currentMatch,
      choice: index,
    };

    onVote(votePayload);
  };

  useEffect(() => {
    if (currentRoundItems.length <= 1) {
      setVoteSummary("Final winner selected");
      return;
    }

    const totalVotes = roomState?.pendingVoteCount ?? 0;
    setVoteSummary(
      totalVotes >= 2
        ? "Both players have voted. Moving to the next matchup."
        : `Waiting for ${Math.max(0, 2 - totalVotes)} more vote${Math.max(0, 2 - totalVotes) === 1 ? "" : "s"}`,
    );
  }, [currentRoundItems.length, roomState?.pendingVoteCount]);

  const left = currentRoundItems[currentMatch * 2];
  const right = currentRoundItems[currentMatch * 2 + 1];

  return (
    <Container>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "8px",
        }}
      >
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip label={`Room ${slug ?? "unknown"}`} color="primary" />
          <Chip label={voteSummary} />
        </Box>
        {currentRoundItems.length === 1 && (
          <Box sx={{ textAlign: "center", mt: 4 }}>
            <Typography variant="h4">Winner</Typography>
            <GameItemCard
              item={currentRoundItems[0]}
              index={0}
              handleVote={null as any}
            />
          </Box>
        )}
        {currentRoundItems.length > 1 && (
          <Box sx={{ textAlign: "center", mt: 4 }}>
            <Typography variant="h4">Round {round + 1}</Typography>

            <Stack
              spacing={4}
              sx={{ justifyContent: "center", marginTop: "4px" }}
            >
              <GameItemCard
                item={left}
                index={currentMatch * 2}
                handleVote={handleVote}
              />

              <Typography variant="h5">vs</Typography>

              {right ? (
                <GameItemCard
                  item={right}
                  index={currentMatch * 2 + 1}
                  handleVote={handleVote}
                />
              ) : (
                <Typography variant="h6">Bye</Typography>
              )}
            </Stack>
          </Box>
        )}
      </Box>
    </Container>
  );
}
