"use client";

import { useState } from "react";
import { Box, Button, Typography, Stack } from "@mui/material";

export default function BracketGame({ bracket, slug, session }) {
  const [round, setRound] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [currentRoundItems, setCurrentRoundItems] = useState(bracket.items);

  const handleVote = (winner) => {
    const nextMatch = currentMatch + 1;

    // If this was the last match in the round
    if (nextMatch >= currentRoundItems.length / 2) {
      const winners = [...currentRoundItems].filter((item, idx) => {
        return idx === winner.index;
      });

      // Build next round
      const nextRoundItems = [];
      for (let i = 0; i < currentRoundItems.length; i += 2) {
        const winner =
          Math.random() < 0.5 ? currentRoundItems[i] : currentRoundItems[i + 1];
        nextRoundItems.push(winner);
      }

      setCurrentRoundItems(nextRoundItems);
      setRound(round + 1);
      setCurrentMatch(0);
    } else {
      setCurrentMatch(nextMatch);
    }
  };

  const left = currentRoundItems[currentMatch * 2];
  const right = currentRoundItems[currentMatch * 2 + 1];

  return (
    <Box sx={{ textAlign: "center", mt: 4 }}>
      <Typography variant="h4">Round {round + 1}</Typography>

      <Stack direction="row" spacing={4} justifyContent="center" mt={4}>
        <Button
          variant="contained"
          onClick={() => handleVote({ item: left, index: currentMatch * 2 })}
        >
          {left.title}
        </Button>

        <Typography variant="h5">vs</Typography>

        <Button
          variant="contained"
          onClick={() =>
            handleVote({ item: right, index: currentMatch * 2 + 1 })
          }
        >
          {right.title}
        </Button>
      </Stack>

      {currentRoundItems.length === 1 && (
        <Typography variant="h3" sx={{ mt: 4 }}>
          Winner: {currentRoundItems[0].title}
        </Typography>
      )}
    </Box>
  );
}
