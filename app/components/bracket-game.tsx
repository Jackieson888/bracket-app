"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { Box, Container, Stack, Typography } from "@mui/material";
import Image from "next/image";

import { ContentCopy, CheckCircle } from "@mui/icons-material";

import GameItemCard, { type Voter } from "./game-item-card";
import { initialsFor } from "@/lib/avatar";
import { focusableButtonSx, onActivateKeyDown } from "@/lib/a11y";
import { buildShareCardUrl } from "@/lib/share-card";

type Item = ComponentProps<typeof GameItemCard>["item"];

type MatchVote = {
  choice: number;
  at: number;
};

const VOTER_COLOR_POOL = [
  "var(--primary)",
  "var(--secondary)",
  "var(--tertiary)",
  "var(--accent)",
  "var(--deep)",
  "var(--primary-dark)",
];

function colorForParticipant(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return VOTER_COLOR_POOL[hash % VOTER_COLOR_POOL.length];
}

function votersForChoice(
  matchVotes: Record<string, MatchVote> | null,
  choice: number,
  participants: Record<string, string>,
): { voters: Voter[]; extraCount: number; count: number } {
  if (!matchVotes) {
    return { voters: [], extraCount: 0, count: 0 };
  }

  const entries = Object.entries(matchVotes)
    .filter(([, vote]) => vote?.choice === choice)
    .sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0));

  const visible = entries.slice(-5).map(([participantId]) => ({
    id: participantId,
    initials: initialsFor(participants[participantId] ?? "Guest"),
    color: colorForParticipant(participantId),
  }));

  return {
    voters: visible,
    extraCount: Math.max(0, entries.length - 5),
    count: entries.length,
  };
}

type BracketGameProps = {
  bracket?: {
    _id?: string;
    items?: Item[];
    title?: string;
  };
  slug?: string;
  session?: unknown;
  connected?: boolean;
  participants?: Record<string, string>;
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
  onPlayAgain?: () => void;
  isHost?: boolean;
  playerCount?: number;
};

export default function BracketGame({
  bracket,
  slug,
  connected,
  participants = {},
  roomState,
  onVote,
  onPlayAgain,
  isHost,
  playerCount,
}: BracketGameProps) {
  const [round, setRound] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [currentRoundItems, setCurrentRoundItems] = useState<Item[]>(
    () => bracket?.items ?? [],
  );
  const [shareCopied, setShareCopied] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [introPhase, setIntroPhase] = useState<"card1" | "vs" | "card2">(
    "card1",
  );
  const [introKey, setIntroKey] = useState(0);
  const [boardVisible, setBoardVisible] = useState(true);

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

  const [bracketStats, setBracketStats] = useState<{
    totalPlays: number;
    itemStats: Array<{ itemId: string; title: string; wins: number }>;
  } | null>(null);

  useEffect(() => {
    const bracketId = bracket?._id;
    if (currentRoundItems.length !== 1 || !bracketId) {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/brackets/${bracketId}/stats`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.totalPlays === "number") {
          setBracketStats(data);
        }
      })
      .catch(() => {
        // Non-critical — the winner screen just skips the stats line.
      });

    return () => controller.abort();
  }, [currentRoundItems.length, bracket?._id]);

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

  const leftVoters = useMemo(
    () => votersForChoice(currentMatchVotes, leftIndex, participants),
    [currentMatchVotes, leftIndex, participants],
  );
  const rightVoters = useMemo(
    () => votersForChoice(currentMatchVotes, rightIndex, participants),
    [currentMatchVotes, rightIndex, participants],
  );

  const requiredVotes = roomState?.requiredVoteCount ?? 0;
  const leftPct =
    requiredVotes > 0
      ? Math.min(100, Math.round((leftVoters.count / requiredVotes) * 100))
      : null;
  const rightPct =
    requiredVotes > 0
      ? Math.min(100, Math.round((rightVoters.count / requiredVotes) * 100))
      : null;

  const leading =
    leftVoters.count === rightVoters.count
      ? "tie"
      : leftVoters.count > rightVoters.count
        ? "left"
        : "right";

  const totalMatchesThisRound = Math.max(
    1,
    Math.ceil(currentRoundItems.length / matchSize),
  );

  const remainingVotes = Math.max(
    0,
    requiredVotes - (leftVoters.count + rightVoters.count),
  );

  const statusLine =
    currentRoundItems.length <= 1
      ? ""
      : remainingVotes > 0
        ? `TAP A CARD · ${remainingVotes} MORE VOTE${remainingVotes === 1 ? "" : "S"} TO ADVANCE`
        : "ADVANCING…";

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

  const handleShare = async (shareUrl: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1400);
    } catch {
      window.open(shareUrl, "_blank", "noopener,noreferrer");
    }
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

    const card1Timer = window.setTimeout(() => setIntroPhase("vs"), 250);
    const card2Timer = window.setTimeout(() => setIntroPhase("card2"), 500);
    const boardTimer = window.setTimeout(() => {
      setShowIntro(false);
      setBoardVisible(true);
    }, 850);

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

  const confetti = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: (i * 137) % 100,
        color: VOTER_COLOR_POOL[i % VOTER_COLOR_POOL.length],
        duration: 1.6 + (i % 5) * 0.25,
        delay: (i % 7) * 0.18,
      })),
    [],
  );

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

  const isFinalWinner = currentRoundItems.length === 1;
  const winnerItem = currentRoundItems[0];
  const shareUrl = winnerItem
    ? buildShareCardUrl({
        imageUrl: winnerItem.url,
        title: winnerItem.title,
        cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      })
    : null;

  return (
    <Container>
      <Box
        className="bracket-shell"
        sx={{
          padding: "18px 18px 26px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "999px",
              backgroundColor: "rgba(255,255,255,0.05)",
            }}
          >
            <Box className="bracket-live-dot" />
            <Typography
              sx={{
                fontFamily: "var(--font-heading)",
                fontSize: "12px",
                letterSpacing: "1.5px",
                color: "text.primary",
              }}
            >
              LIVE {slug ? ` · ${slug}` : ""}
            </Typography>
          </Box>
          {typeof playerCount === "number" ? (
            <Typography
              sx={{
                fontFamily: "var(--font-heading)",
                fontSize: "12px",
                letterSpacing: "1.5px",
                color: "text.secondary",
                padding: "6px 12px",
                borderRadius: "999px",
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
            >
              {playerCount} PLAYER{playerCount > 1 ? "S" : ""}
            </Typography>
          ) : null}
        </Stack>
        {bracket?.title ? (
          <Typography
            sx={{
              textAlign: "center",
              fontFamily: "var(--font-heading)",
              fontSize: "13px",
              letterSpacing: "1px",
              color: "text.secondary",
            }}
          >
            {bracket.title}
          </Typography>
        ) : null}
        {!isFinalWinner ? (
          <Box sx={{ textAlign: "center", pt: 0.5 }}>
            <Typography
              component="h1"
              sx={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "34px",
                lineHeight: 1.1,
                letterSpacing: "1px",
                color: "info.main",
              }}
            >
              ROUND {round + 1}
            </Typography>
            <Typography
              sx={{
                fontFamily: "var(--font-heading)",
                fontSize: "13px",
                letterSpacing: "3px",
                color: "text.secondary",
                mt: 0.25,
              }}
            >
              MATCH {Math.min(currentMatch + 1, totalMatchesThisRound)} OF{" "}
              {totalMatchesThisRound}
            </Typography>
          </Box>
        ) : null}

        {!isFinalWinner && boardVisible ? (
          <Box
            key={matchKey}
            className="bracket-round-panel bracket-round-panel--visible"
            sx={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: "22px",
              mt: 0.75,
            }}
          >
            <Box
              className="bracket-round-item bracket-round-item--left"
              style={
                {
                  ["--bracket-item-delay" as "--bracket-item-delay"]: "0ms",
                } as CSSProperties
              }
            >
              {left ? (
                <GameItemCard
                  item={left}
                  index={leftIndex}
                  handleVote={handleVote}
                  voters={leftVoters.voters}
                  extraVoterCount={leftVoters.extraCount}
                  votePct={leftPct}
                  accentColor={leading === "left" ? "var(--primary)" : null}
                  className="bracket-round-item__card"
                />
              ) : null}
            </Box>

            {right ? (
              <Box
                sx={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: "52px",
                  height: "52px",
                  zIndex: 3,
                  transform: "translate(-50%, -50%)",
                }}
                className="bracket-vs-badge"
              >
                <Box
                  sx={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "50%",
                    backgroundColor: "var(--tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: "var(--font-display)",
                      fontSize: "12px",
                      color: "var(--card)",
                    }}
                  >
                    VS
                  </Typography>
                </Box>
              </Box>
            ) : null}

            {right ? (
              <Box
                className="bracket-round-item bracket-round-item--right"
                style={
                  {
                    ["--bracket-item-delay" as "--bracket-item-delay"]: "60ms",
                  } as CSSProperties
                }
              >
                <GameItemCard
                  item={right}
                  index={rightIndex}
                  handleVote={handleVote}
                  voters={rightVoters.voters}
                  extraVoterCount={rightVoters.extraCount}
                  votePct={rightPct}
                  accentColor={leading === "right" ? "var(--secondary)" : null}
                  className="bracket-round-item__card"
                />
              </Box>
            ) : null}
          </Box>
        ) : null}

        {!isFinalWinner ? (
          <Typography
            sx={{
              textAlign: "center",
              fontFamily: "var(--font-heading)",
              fontSize: "12px",
              letterSpacing: "2px",
              color: "text.secondary",
            }}
          >
            {statusLine}
          </Typography>
        ) : null}

        {connected === false ? (
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              pt: 0.25,
            }}
          >
            <Box className="bracket-synced-dot" sx={{ backgroundColor: "text.secondary" }} />
            <Typography
              sx={{
                fontFamily: "var(--font-mono-ui)",
                fontSize: "10px",
                letterSpacing: "1px",
                color: "text.secondary",
              }}
            >
              RECONNECTING
            </Typography>
          </Stack>
        ) : null}

        {showIntro && left ? (
          <Box className="bracket-intro-overlay">
            <Box className="bracket-intro-stage">
              <Box
                key={`${introKey}-card1`}
                className="bracket-intro-card bracket-intro-card--card1"
              >
                <GameItemCard
                  item={left}
                  index={leftIndex}
                  handleVote={handleVote}
                  className="bracket-round-item__card"
                />
              </Box>

              {introPhase !== "card1" ? (
                <Box
                  key={`${introKey}-vs`}
                  className="bracket-intro-vs"
                  sx={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "50%",
                    backgroundColor: "var(--tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: "var(--font-display)",
                      fontSize: "14px",
                      color: "var(--card)",
                    }}
                  >
                    VS
                  </Typography>
                </Box>
              ) : null}

              {introPhase === "card2" && right ? (
                <Box
                  key={`${introKey}-card2`}
                  className="bracket-intro-card bracket-intro-card--card2"
                >
                  <GameItemCard
                    item={right}
                    index={rightIndex}
                    handleVote={handleVote}
                    className="bracket-round-item__card"
                  />
                </Box>
              ) : null}
            </Box>
          </Box>
        ) : null}

        {isFinalWinner ? (
          <Box className="bracket-winner-overlay">
            {confetti.map((piece, i) => (
              <Box
                key={i}
                className="bracket-confetti-piece"
                sx={{
                  left: `${piece.left}%`,
                  backgroundColor: piece.color,
                  animationDuration: `${piece.duration}s`,
                  animationDelay: `${piece.delay}s`,
                }}
              />
            ))}
            <Typography
              component="h1"
              sx={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "26px",
                letterSpacing: "1px",
                color: "info.main",
                position: "relative",
                zIndex: 2,
              }}
            >
              WINNER
            </Typography>
            <Box
              className="bracket-winner-card"
              sx={{
                width: "100%",
                maxWidth: "300px",
                borderRadius: "22px",
                backgroundColor: "background.paper",
                border: "2px solid var(--primary)",
                padding: "22px",
                textAlign: "center",
                position: "relative",
                zIndex: 2,
              }}
            >
              <Box
                sx={{
                  height: "120px",
                  borderRadius: "14px",
                  overflow: "hidden",
                  position: "relative",
                  marginBottom: "14px",
                  background:
                    "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 10px, rgba(255,255,255,0.015) 10px 20px)",
                }}
              >
                {currentRoundItems[0]?.url ? (
                  <Image
                    src={currentRoundItems[0].url}
                    alt={currentRoundItems[0].title}
                    fill
                    sizes="300px"
                    style={{ objectFit: "cover" }}
                  />
                ) : null}
              </Box>
              <Typography
                sx={{
                  fontFamily: "var(--font-body)",
                  fontWeight: 800,
                  fontSize: "26px",
                  color: "text.primary",
                }}
              >
                {currentRoundItems[0]?.title}
              </Typography>
              {bracketStats && bracketStats.totalPlays > 0
                ? (() => {
                    const winnerStat = bracketStats.itemStats.find(
                      (stat) => stat.itemId === currentRoundItems[0]?.id,
                    );
                    if (!winnerStat) {
                      return null;
                    }

                    return (
                      <Typography
                        sx={{
                          mt: "6px",
                          fontFamily: "var(--font-body)",
                          fontSize: "12px",
                          color: "text.secondary",
                        }}
                      >
                        {winnerStat.title} has now won {winnerStat.wins} of{" "}
                        {bracketStats.totalPlays}{" "}
                        {bracketStats.totalPlays === 1 ? "play" : "plays"} of
                        this bracket.
                      </Typography>
                    );
                  })()
                : null}
            </Box>
            <Stack
              direction="row"
              spacing="10px"
              sx={{
                position: "relative",
                zIndex: 2,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              {isHost ? (
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => onPlayAgain?.()}
                  onKeyDown={onActivateKeyDown(() => onPlayAgain?.())}
                  className="bracket-glow-pulse"
                  sx={{
                    ...focusableButtonSx,
                    cursor: "pointer",
                    padding: "13px 28px",
                    borderRadius: "14px",
                    backgroundColor: "var(--accent)",
                    fontFamily: "var(--font-heading)",
                    fontSize: "14px",
                    letterSpacing: "2px",
                    color: "var(--card)",
                  }}
                >
                  PLAY AGAIN
                </Box>
              ) : null}
              <Box
                component="a"
                href="/play"
                sx={{
                  display: "inline-block",
                  textDecoration: "none",
                  cursor: "pointer",
                  padding: "13px 28px",
                  borderRadius: "14px",
                  backgroundColor: "var(--tertiary)",
                  fontFamily: "var(--font-heading)",
                  fontSize: "14px",
                  letterSpacing: "2px",
                  color: "var(--card)",
                }}
              >
                DIFFERENT BRACKET
              </Box>
              {shareUrl ? (
                <Box
                  role="button"
                  tabIndex={0}
                  aria-label={shareCopied ? "Share link copied" : "Copy share link"}
                  onClick={() => void handleShare(shareUrl)}
                  onKeyDown={onActivateKeyDown(() => void handleShare(shareUrl))}
                  sx={{
                    ...focusableButtonSx,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    padding: "13px 28px",
                    borderRadius: "14px",
                    backgroundColor: "var(--secondary)",
                    fontFamily: "var(--font-heading)",
                    fontSize: "14px",
                    letterSpacing: "2px",
                    color: "var(--card)",
                  }}
                >
                  {shareCopied ? (
                    <CheckCircle sx={{ fontSize: 16 }} />
                  ) : (
                    <ContentCopy sx={{ fontSize: 15 }} />
                  )}
                  {shareCopied ? "COPIED" : "SHARE"}
                </Box>
              ) : null}
            </Stack>
          </Box>
        ) : null}
      </Box>
    </Container>
  );
}
