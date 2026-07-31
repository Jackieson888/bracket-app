"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import {
  Box,
  Typography,
  Stack,
  Container,
  Chip,
  Divider,
} from "@mui/material";
import GameItemCard from "./game-item-card";

type Item = ComponentProps<typeof GameItemCard>["item"];

type BracketGameProps = {
  bracket?: {
    items?: Item[];
    title?: string;
  };
  slug?: string;
  session?: unknown;
  roomState?: {
    round?: number;
    currentMatch?: number;
    currentRoundItems?: Item[];
    votesByMatch?: Record<
      string,
      Record<string, { choice: number; at: number }>
    >;
    pendingVoteCount?: number;
    requiredVoteCount?: number;
    winner?: Item | null;
  };
  onVote?: (payload: { round: number; match: number; choice: number }) => void;
  playerCount?: number;
};

export default function BracketGame({
  bracket,
  slug,
  session,
  roomState,
  onVote,
  playerCount = 2,
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
    const requiredVotes =
      roomState?.requiredVoteCount ?? Math.max(1, Math.min(2, playerCount));
    const votesRemaining = Math.max(0, requiredVotes - totalVotes);

    setVoteSummary(
      totalVotes >= requiredVotes
        ? "Votes received. Moving to the next matchup."
        : `Waiting for ${votesRemaining} more vote${votesRemaining === 1 ? "" : "s"}`,
    );
  }, [
    currentRoundItems.length,
    playerCount,
    roomState?.pendingVoteCount,
    roomState?.requiredVoteCount,
  ]);

  const leftIndex = currentMatch * 2;
  const rightIndex = leftIndex + 1;
  const left = currentRoundItems[leftIndex];
  const right = currentRoundItems[rightIndex];
  const requiredVotes =
    roomState?.requiredVoteCount ?? Math.max(1, Math.min(2, playerCount));
  const totalVotes = roomState?.pendingVoteCount ?? 0;
  const currentMatchVotes = roomState?.votesByMatch?.[currentMatch] ?? null;
  const matchupAnimationKey = `${round}:${currentMatch}:${left?.title ?? "left"}:${right?.title ?? "right"}:${currentRoundItems.length}`;

  const winnerIndex = useMemo(() => {
    if (!currentRoundItems.length) {
      return null;
    }

    if (currentRoundItems.length === 1) {
      return 0;
    }

    if (!left) {
      return null;
    }

    if (!right) {
      return leftIndex;
    }

    if (totalVotes < requiredVotes || !currentMatchVotes) {
      return null;
    }

    return resolveWinningChoice(currentMatchVotes, leftIndex, rightIndex);
  }, [
    currentMatchVotes,
    currentRoundItems.length,
    left,
    leftIndex,
    requiredVotes,
    right,
    rightIndex,
    totalVotes,
  ]);

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
        <Stack>
          <Typography variant="h5">
            {bracket?.title || "Bracket Game"}
          </Typography>
          <Divider
            sx={{
              border: (theme) => `2px solid ${theme.palette.primary.main}`,
              width: "stretch",
              borderRadius: "12px",
            }}
          />
        </Stack>
        {currentRoundItems.length === 1 && (
          <Box
            className="bracket-round-panel"
            sx={{ textAlign: "center", mt: 4 }}
          >
            <Box
              className="bracket-round-banner bracket-round-banner--winner"
              sx={{
                backgroundColor: (theme) => theme.palette.background.paper,
                borderRadius: "12px",
                padding: "0 12px 0 8px",
                textShadow: "4px 4px 0 #A73E26",
              }}
            >
              <Typography
                variant="h2"
                color="info"
                sx={{ lineHeight: 1, marginBottom: "-8px" }}
              >
                WINNER
              </Typography>
            </Box>
            <Box
              className="bracket-round-item bracket-round-item--winner"
              style={
                {
                  ["--bracket-item-delay" as "--bracket-item-delay"]: "180ms",
                } as CSSProperties
              }
            >
              <GameItemCard
                item={currentRoundItems[0]}
                index={0}
                handleVote={null as any}
                votes={null}
                className="bracket-round-item__card"
              />
            </Box>
          </Box>
        )}
        {currentRoundItems.length > 1 && (
          <Box
            key={matchupAnimationKey}
            className="bracket-round-panel"
            sx={{ textAlign: "center", mt: 1 }}
          >
            <Stack
              direction="row"
              className="bracket-round-header"
              sx={{ alignItems: "center", justifyContent: "center" }}
            >
              <Typography
                variant="h4"
                className="bracket-round-label"
                sx={{
                  color: (theme) => theme.palette.background.paper,
                  marginRight: "16px",
                }}
              >
                Round
              </Typography>
              <Box
                className="bracket-round-banner"
                sx={{
                  backgroundColor: (theme) => theme.palette.background.paper,
                  borderRadius: "12px",
                  padding: "0 12px 0 8px",
                  textShadow: "4px 4px 0 #A73E26",
                }}
              >
                <Typography
                  variant="h2"
                  color="info"
                  sx={{ lineHeight: 1, marginBottom: "-8px" }}
                >
                  {round + 1}
                </Typography>
              </Box>
            </Stack>

            <Stack
              className="bracket-matchup-stack"
              spacing={2}
              sx={{ justifyContent: "center", marginTop: "32px" }}
            >
              <Box
                className={`bracket-round-item bracket-round-item--left${winnerIndex === leftIndex ? " bracket-round-item--winner" : ""}`}
                style={
                  {
                    ["--bracket-item-delay" as "--bracket-item-delay"]: "140ms",
                  } as CSSProperties
                }
              >
                <GameItemCard
                  item={left}
                  index={leftIndex}
                  handleVote={handleVote}
                  votes={
                    roomState?.votesByMatch?.[currentMatch]?.[left.title ?? ""]
                      ?.choice ?? null
                  }
                  className="bracket-round-item__card"
                />
              </Box>

              {right ? (
                <Typography
                  variant="h4"
                  className="bracket-round-vs"
                  sx={{
                    color: (theme) => theme.palette.background.default,
                    marginRight: "16px",
                  }}
                >
                  vs
                </Typography>
              ) : null}

              {right ? (
                <Box
                  className={`bracket-round-item bracket-round-item--right${winnerIndex === rightIndex ? " bracket-round-item--winner" : ""}`}
                  style={
                    {
                      ["--bracket-item-delay" as "--bracket-item-delay"]:
                        "360ms",
                    } as CSSProperties
                  }
                >
                  <GameItemCard
                    item={right}
                    index={rightIndex}
                    handleVote={handleVote}
                    votes={
                      roomState?.votesByMatch?.[currentMatch]?.[
                        right.title ?? ""
                      ]?.choice ?? null
                    }
                    className="bracket-round-item__card"
                  />
                </Box>
              ) : null}
            </Stack>
          </Box>
        )}
      </Box>
    </Container>
  );
}

function resolveWinningChoice(
  matchVotes: Record<string, { choice: number; at: number }>,
  leftIndex: number,
  rightIndex: number,
) {
  const tally = {
    [leftIndex]: 0,
    [rightIndex]: 0,
  };

  Object.values(matchVotes).forEach((vote) => {
    if (vote?.choice === rightIndex) {
      tally[rightIndex] += 1;
      return;
    }

    tally[leftIndex] += 1;
  });

  if (tally[rightIndex] > tally[leftIndex]) {
    return rightIndex;
  }

  return leftIndex;
}
