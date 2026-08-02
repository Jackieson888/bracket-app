"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { Box, Container, Divider, Stack, Typography } from "@mui/material";

import GameItemCard from "./game-item-card";

type Item = ComponentProps<typeof GameItemCard>["item"];

type MatchVote = {
  choice: number;
  at: number;
};

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
    matchSize?: number;
    votesByMatch?: Record<string, Record<string, MatchVote>>;
    pendingVoteCount?: number;
    requiredVoteCount?: number;
    winner?: Item | null;
    lastWinner?: Item | null;
  };
  onVote?: (payload: { round: number; match: number; choice: number }) => void;
  playerCount?: number;
};

export default function BracketGame({
  bracket,
  roomState,
  onVote,
}: BracketGameProps) {
  const [round, setRound] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [currentRoundItems, setCurrentRoundItems] = useState<Item[]>(
    () => bracket?.items ?? [],
  );
  const [voteSummary, setVoteSummary] = useState("Waiting for votes");
  const [showIntro, setShowIntro] = useState(false);
  const [introPhase, setIntroPhase] = useState<"card1" | "vs" | "card2">(
    "card1",
  );
  const [introKey, setIntroKey] = useState(0);
  const [boardVisible, setBoardVisible] = useState(true);
  const [recentWinner, setRecentWinner] = useState<string | null>(null);

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

  const matchSize = Math.max(2, roomState?.matchSize ?? 2);
  const startIndex = currentMatch * matchSize;
  const activeMatchItems = currentRoundItems.slice(
    startIndex,
    startIndex + matchSize,
  );
  const left = activeMatchItems[0] ?? null;
  const right = activeMatchItems[1] ?? null;
  const matchKey = `${round}:${currentMatch}`;
  const currentMatchVotes = roomState?.votesByMatch?.[matchKey] ?? null;
  const leftIndex = startIndex;
  const rightIndex = startIndex + 1;
  const leftVoteCount = countVotesForChoice(currentMatchVotes, leftIndex);
  const rightVoteCount = right
    ? countVotesForChoice(currentMatchVotes, rightIndex)
    : null;

  const winnerIndex = useMemo(() => {
    if (!roomState?.winner) {
      return null;
    }

    if (roomState.winner.title === left?.title) {
      return leftIndex;
    }

    if (roomState.winner.title === right?.title) {
      return rightIndex;
    }

    return null;
  }, [left?.title, leftIndex, right?.title, rightIndex, roomState?.winner]);

  const handleVote = ({ index }: { item: Item; index: number }) => {
    if (!onVote) {
      return;
    }

    onVote({
      round,
      match: currentMatch,
      choice: index,
    });
  };

  useEffect(() => {
    if (currentRoundItems.length <= 1) {
      setShowIntro(false);
      setBoardVisible(true);
      return;
    }

    if (!left) {
      return;
    }

    setIntroKey((value) => value + 1);
    setIntroPhase("card1");
    setShowIntro(true);
    setBoardVisible(false);

    const card1Timer = window.setTimeout(() => setIntroPhase("vs"), 900);
    const card2Timer = window.setTimeout(() => setIntroPhase("card2"), 1600);
    const boardTimer = window.setTimeout(() => {
      setShowIntro(false);
      setBoardVisible(true);
    }, 2600);

    return () => {
      window.clearTimeout(card1Timer);
      window.clearTimeout(card2Timer);
      window.clearTimeout(boardTimer);
    };
  }, [
    currentMatch,
    currentRoundItems.length,
    left?.title,
    round,
    right?.title,
  ]);

  useEffect(() => {
    if (!roomState?.lastWinner?.title) {
      return;
    }

    setRecentWinner(roomState.lastWinner.title);
    const timer = window.setTimeout(() => {
      setRecentWinner(null);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [roomState?.lastWinner?.title]);

  useEffect(() => {
    if (currentRoundItems.length <= 1) {
      setVoteSummary("Final winner selected");
      return;
    }

    const totalVotes = roomState?.pendingVoteCount ?? 0;
    const requiredVotes =
      roomState?.requiredVoteCount ?? Math.max(2, totalVotes);

    setVoteSummary(`${totalVotes}/${requiredVotes} votes cast`);
  }, [
    currentRoundItems.length,
    roomState?.pendingVoteCount,
    roomState?.requiredVoteCount,
  ]);

  if (!currentRoundItems.length) {
    return (
      <Container>
        <Box sx={{ padding: 2 }}>
          <Typography variant="h5">
            {bracket?.title || "Bracket Game"}
          </Typography>
          <Typography sx={{ mt: 2 }}>
            No bracket items are available.
          </Typography>
        </Box>
      </Container>
    );
  }

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
        <Stack spacing={1}>
          <Typography variant="h5">
            {bracket?.title || "Bracket Game"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {voteSummary}
          </Typography>
          <Divider
            sx={{
              border: (theme) => `2px solid ${theme.palette.primary.main}`,
              width: "stretch",
              borderRadius: "12px",
            }}
          />
        </Stack>

        {currentRoundItems.length === 1 ? (
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
                handleVote={handleVote}
                votes={null}
                className="bracket-round-item__card"
              />
            </Box>
          </Box>
        ) : (
          <Box
            key={matchKey}
            className={`bracket-round-panel${boardVisible ? " bracket-round-panel--visible" : " bracket-round-panel--hidden"}`}
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
                {left ? (
                  <GameItemCard
                    item={left}
                    index={leftIndex}
                    handleVote={handleVote}
                    votes={leftVoteCount}
                    className="bracket-round-item__card"
                  />
                ) : null}
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
                    votes={rightVoteCount}
                    className="bracket-round-item__card"
                  />
                </Box>
              ) : null}
            </Stack>

            {recentWinner ? (
              <Typography
                variant="h4"
                sx={{
                  mt: 2,
                  color: (theme) => theme.palette.background.paper,
                  textAlign: "center",
                  textShadow: "3px 3px 0 #A73E26",
                }}
              >
                Winner: {recentWinner}
              </Typography>
            ) : null}
          </Box>
        )}

        {showIntro && left ? (
          <Box className="bracket-intro-overlay">
            <Box className="bracket-intro-stage">
              <Box
                key={`${introKey}-card1`}
                className={`bracket-intro-card bracket-intro-card--card1${introPhase === "card1" ? " is-active" : ""}`}
              >
                <GameItemCard
                  item={left}
                  index={leftIndex}
                  handleVote={handleVote}
                  votes={leftVoteCount}
                  className="bracket-round-item__card"
                />
              </Box>

              {introPhase !== "card1" ? (
                <Typography
                  key={`${introKey}-vs`}
                  className={`bracket-intro-vs${introPhase === "vs" || introPhase === "card2" ? " is-active" : ""}`}
                  variant="h3"
                >
                  vs
                </Typography>
              ) : null}

              {introPhase === "card2" && right ? (
                <Box
                  key={`${introKey}-card2`}
                  className="bracket-intro-card bracket-intro-card--card2 is-active"
                >
                  <GameItemCard
                    item={right}
                    index={rightIndex}
                    handleVote={handleVote}
                    votes={rightVoteCount}
                    className="bracket-round-item__card"
                  />
                </Box>
              ) : null}
            </Box>
          </Box>
        ) : null}
      </Box>
    </Container>
  );
}

function countVotesForChoice(
  matchVotes: Record<string, MatchVote> | null,
  choice: number,
) {
  if (!matchVotes) {
    return 0;
  }

  return Object.values(matchVotes).reduce((count, vote) => {
    return vote?.choice === choice ? count + 1 : count;
  }, 0);
}
