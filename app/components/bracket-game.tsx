"use client";

import { useState, type ComponentProps } from "react";
import { Box, Typography, Stack, Container } from "@mui/material";
import GameItemCard from "./game-item-card";

type Item = ComponentProps<typeof GameItemCard>["item"];

type BracketGameProps = {
  bracket?: {
    items?: Item[];
  };
  slug?: string;
  session?: unknown;
};

export default function BracketGame({
  bracket,
  slug,
  session,
}: BracketGameProps) {
  const [round, setRound] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [currentRoundItems, setCurrentRoundItems] = useState<Item[]>(
    () => bracket?.items ?? [],
  );

  function buildNextRound(items: Item[]) {
    const winners: Item[] = [];

    for (let i = 0; i < items.length; i += 2) {
      const left = items[i];
      const right = items[i + 1];

      if (!right) {
        winners.push(left); // bye
        continue;
      }

      const winner = Math.random() < 0.5 ? left : right;
      winners.push(winner);
    }

    return winners;
  }

  const handleVote = ({ index }: { item: Item; index: number }) => {
    const nextMatch = currentMatch + 1;

    // FINAL ROUND: only 2 items left
    if (currentRoundItems.length === 2) {
      // Ensure we are on the first (and only) match
      setCurrentMatch(0);

      const winner = currentRoundItems[index];
      setCurrentRoundItems([winner]);
      return;
    }

    if (nextMatch >= Math.floor(currentRoundItems.length / 2)) {
      const nextRoundItems = buildNextRound(currentRoundItems);

      console.log("NEXT ROUND ITEMS:", nextRoundItems);

      setCurrentRoundItems(nextRoundItems);
      setRound(round + 1);

      // ALWAYS reset match index when entering a new round
      setCurrentMatch(0);

      return;
    }

    // NORMAL MATCH ADVANCE
    setCurrentMatch(nextMatch);
  };

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
        {currentRoundItems.length === 1 && (
          <h1>
            Winner: <pre>{JSON.stringify(currentRoundItems)}</pre>
          </h1>
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
