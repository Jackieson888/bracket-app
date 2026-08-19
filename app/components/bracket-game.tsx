"use client";

import {
  useCallback,
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
import MatchIntro from "./match-intro";
import { initialsFor } from "@/lib/avatar";
import { focusableButtonSx, onActivateKeyDown } from "@/lib/a11y";
import { buildShareCardUrl } from "@/lib/share-card";
import { previewImageUrl } from "@/lib/media";

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
    initials: initialsFor(participants[participantId]),
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
    matchDeadline?: number | null;
    matchHistory?: Array<{
      round: number;
      match: number;
      items: Array<{ id: string; title: string }>;
      voteCounts: Record<string, number>;
      winnerItemId: string;
      wasBye: boolean;
    }>;
  };
  onVote?: (payload: { round: number; match: number; choice: number }) => void;
  onPlayAgain?: () => void;
  onForceAdvance?: () => void;
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
  onForceAdvance,
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

  // Choices are hidden until the match settles, so the board reports who has
  // locked in rather than how the vote is going.
  const votedIds = useMemo(
    () => new Set(Object.keys(currentMatchVotes ?? {})),
    [currentMatchVotes],
  );
  const lockedInCount = votedIds.size;
  const waitingOn = useMemo(
    () =>
      Object.entries(participants)
        .filter(([participantId]) => !votedIds.has(participantId))
        .map(([, name]) => name || "Guest"),
    [participants, votedIds],
  );

  const deadline = roomState?.matchDeadline ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) {
      return;
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [deadline]);

  const secondsLeft =
    deadline && currentRoundItems.length > 1
      ? Math.max(0, Math.ceil((deadline - nowMs) / 1000))
      : null;

  const statusLine =
    currentRoundItems.length <= 1
      ? ""
      : remainingVotes > 0
        ? `TAP A CARD · ${lockedInCount} OF ${requiredVotes} LOCKED IN`
        : "REVEALING…";

  // The result of the match that just finished, revealed at the start of the
  // next matchup instead of leaking live while people are still voting.
  const previousResult = useMemo(() => {
    const history = roomState?.matchHistory ?? [];
    const last = history[history.length - 1];
    if (!last || last.wasBye || (last.items?.length ?? 0) < 2) {
      return null;
    }
    return last;
  }, [roomState?.matchHistory]);

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

  // The intro itself sequences the two contenders (and plays their clips) —
  // this only decides when a new match should re-open it.
  useEffect(() => {
    if (currentRoundItems.length <= 1 || !left) {
      setShowIntro(false);
      setBoardVisible(true);
      return;
    }

    setShowIntro(true);
    setBoardVisible(false);
  }, [
    currentMatch,
    currentRoundItems.length,
    left?.id,
    left?.title,
    round,
    right?.id,
    right?.title,
  ]);

  // Two beats, not one: the board mounts while the overlay is still fading,
  // then the overlay unmounts once that fade is done.
  const handleRevealBoard = useCallback(() => {
    setBoardVisible(true);
  }, []);

  const handleIntroComplete = useCallback(() => {
    setShowIntro(false);
    setBoardVisible(true);
  }, []);

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
  // A video winner has no image derivative, so the winner card shows its
  // poster frame. The share card takes the raw url and applies its own frame
  // grab, so it must not be handed an already-transformed poster.
  const winnerPreviewUrl = previewImageUrl(winnerItem);
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
        className={`bracket-shell${isFinalWinner ? "" : " bracket-shell--game"}`}
        sx={{
          padding: "12px 14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
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
                fontSize: "clamp(20px, 5vw, 30px)",
                lineHeight: 1.05,
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
              mt: 0.75,
            }}
          >
            <Box
              className="bracket-round-item bracket-round-item--left"
              style={
                {
                  ["--bracket-item-delay" as const]: "0ms",
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

            {/* In flow between the two cards, pulled into the gap with
                negative margins, so it tracks the real boundary whatever
                height each card ends up being. */}
            {right ? (
              <Box className="bracket-vs-badge">
                <Typography className="bracket-vs-label">VS</Typography>
              </Box>
            ) : null}

            {right ? (
              <Box
                className="bracket-round-item bracket-round-item--right"
                style={
                  {
                    ["--bracket-item-delay" as const]: "60ms",
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
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
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

            {secondsLeft !== null ? (
              <Box
                className="bracket-timer"
                data-urgent={secondsLeft <= 10 ? "true" : undefined}
                role="timer"
                aria-label={`${secondsLeft} seconds left to vote`}
              >
                <Box
                  className="bracket-timer-fill"
                  sx={{ width: `${Math.min(100, (secondsLeft / 30) * 100)}%` }}
                />
                <span className="bracket-timer-value">{secondsLeft}s</span>
              </Box>
            ) : null}

            {waitingOn.length > 0 && waitingOn.length <= 6 ? (
              <Typography
                sx={{
                  textAlign: "center",
                  fontFamily: "var(--font-body)",
                  fontSize: "12px",
                  color: "text.secondary",
                }}
              >
                Waiting on {waitingOn.join(", ")}
              </Typography>
            ) : null}

            {/* The host override lived here, but it cost a whole row of
                vertical space on phones. The vote timer already guarantees a
                match cannot stall, so this is not the only escape hatch. */}
          </Box>
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
          <MatchIntro
            key={matchKey}
            left={left}
            right={right}
            previousResult={previousResult}
            onRevealBoard={handleRevealBoard}
            onComplete={handleIntroComplete}
          />
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
                  height: "clamp(110px, 20vh, 170px)",
                  borderRadius: "14px",
                  overflow: "hidden",
                  position: "relative",
                  marginBottom: "14px",
                  background:
                    "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 10px, rgba(255,255,255,0.015) 10px 20px)",
                }}
              >
                {winnerPreviewUrl ? (
                  <Image
                    src={winnerPreviewUrl}
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
