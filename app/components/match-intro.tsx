"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Box, Typography } from "@mui/material";
import Image from "next/image";
import {
  MAX_INTRO_CLIP_MS,
  isVideoItem,
  previewImageUrl,
  videoPosterUrl,
  videoSourceUrl,
} from "@/lib/media";
import { focusableButtonSx } from "@/lib/a11y";

export type IntroItem = {
  id?: string;
  url?: string;
  title: string;
  mediaType?: "image" | "video";
  duration?: number | null;
};

type Phase = "result" | "card1" | "vs" | "card2" | "both" | "done";

export type MatchResult = {
  items: Array<{ id: string; title: string }>;
  voteCounts: Record<string, number>;
  winnerItemId: string;
};

// Still contenders only need long enough to register before the next beat.
const STILL_CARD_MS = 250;
const VS_MS = 250;
// Long enough to read the split before the next matchup takes over.
const RESULT_MS = 2600;
// Beat where both contenders sit level, after each has had the stage to
// itself, so the pairing reads as a matchup before the board takes over.
const BOTH_MS = 900;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// useSyncExternalStore is the right tool for reading a browser-owned value:
// it subscribes without the state-in-effect round trip and gives SSR an
// explicit snapshot instead of rendering the wrong value then correcting it.
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

function IntroClip({
  item,
  active,
  showControls,
  onEnded,
}: {
  item: IntroItem;
  active: boolean;
  showControls: boolean;
  onEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const src = videoSourceUrl(item.url) ?? item.url;
  const poster = videoPosterUrl(item) ?? undefined;

  // Keep the latest callback without making it an effect dependency — a new
  // identity mid-clip would otherwise restart playback from the top.
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    // Once this card's turn is over the clip freezes on its last frame while
    // the next contender takes over, so the two never play over each other.
    if (!active) {
      video.pause();
      return;
    }

    let cancelled = false;
    video.muted = false;

    void video.play().catch(() => {
      if (cancelled) return;
      // The browser blocked audible autoplay (no qualifying user gesture yet).
      // Fall back to a muted play so the clip is still seen, and offer a tap
      // to bring the sound back.
      video.muted = true;
      setSoundBlocked(true);
      void video.play().catch(() => {
        // Playback is unavailable entirely - do not strand the intro overlay.
        if (!cancelled) onEndedRef.current();
      });
    });

    return () => {
      cancelled = true;
    };
  }, [src, active]);

  const handleUnmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setSoundBlocked(false);
    void video.play().catch(() => {});
  };

  return (
    <Box
      sx={{ position: "relative", display: "flex", justifyContent: "center" }}
    >
      <video
        ref={videoRef}
        className="bracket-intro-media"
        src={src ?? undefined}
        poster={poster}
        preload="auto"
        playsInline
        controls={showControls}
        aria-label={`Clip for ${item.title}`}
        onEnded={() => onEndedRef.current()}
        onError={() => onEndedRef.current()}
      />
      {soundBlocked && active ? (
        <Box
          component="button"
          type="button"
          aria-label="Turn on clip sound"
          onClick={(event) => {
            event.stopPropagation();
            handleUnmute();
          }}
          className="bracket-intro-unmute"
          sx={focusableButtonSx}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
            <path
              d="m17 9 4 6m0-6-4 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          TAP FOR SOUND
        </Box>
      ) : null}
    </Box>
  );
}

function IntroCard({
  item,
  active,
  minimized,
  showControls,
  onClipEnded,
  className,
}: {
  item: IntroItem;
  active: boolean;
  minimized?: boolean;
  showControls: boolean;
  onClipEnded: () => void;
  className: string;
}) {
  const isVideo = isVideoItem(item);
  const stillUrl = previewImageUrl(item);

  return (
    <Box className={className} data-minimized={minimized ? "true" : undefined}>
      <Box className="bracket-intro-card-inner">
        <Box className="bracket-intro-media-frame">
          {isVideo ? (
            <IntroClip
              item={item}
              active={active}
              showControls={showControls}
              onEnded={onClipEnded}
            />
          ) : stillUrl ? (
            <Image
              className="bracket-intro-media"
              src={stillUrl}
              alt={item.title}
              width={980}
              height={620}
              sizes="(max-width: 640px) 100vw, 980px"
            />
          ) : null}
        </Box>
        <Typography className="bracket-intro-card-title">
          {item.title}
        </Typography>
      </Box>
    </Box>
  );
}

const noop = () => {};

function ResultReveal({ result }: { result: MatchResult }) {
  const total = Object.values(result.voteCounts).reduce((a, b) => a + b, 0);

  return (
    <Box className="bracket-reveal">
      <Typography className="bracket-reveal-label">LAST MATCH</Typography>
      {result.items.map((item) => {
        const count = result.voteCounts[item.id] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const won = item.id === result.winnerItemId;

        return (
          <Box key={item.id} className="bracket-reveal-row" data-won={won ? "true" : undefined}>
            <Box className="bracket-reveal-bar" sx={{ width: `${pct}%` }} />
            <span className="bracket-reveal-title">{item.title}</span>
            <span className="bracket-reveal-count">{count}</span>
          </Box>
        );
      })}
    </Box>
  );
}

export default function MatchIntro({
  left,
  right,
  previousResult,
  onComplete,
}: {
  left: IntroItem;
  right?: IntroItem | null;
  previousResult?: MatchResult | null;
  onComplete: () => void;
}) {
  // The clip is the contender here, not decoration, so a reduced-motion
  // preference keeps playback but exposes controls to pause it. The card
  // pop/slide animations are separately disabled in globals.css.
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>(
    previousResult ? "result" : "card1",
  );

  const advance = useCallback(() => {
    setPhase((current) => {
      if (current === "result") return "card1";
      if (current === "card1") return right ? "vs" : "done";
      if (current === "vs") return "card2";
      if (current === "card2") return "both";
      return "done";
    });
  }, [right]);

  const skip = useCallback(() => setPhase("done"), []);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (phase === "done") {
      onCompleteRef.current();
      return;
    }

    if (phase === "result") {
      const resultTimer = window.setTimeout(advance, RESULT_MS);
      return () => window.clearTimeout(resultTimer);
    }

    if (phase === "both") {
      const settleTimer = window.setTimeout(advance, BOTH_MS);
      return () => window.clearTimeout(settleTimer);
    }

    const item = phase === "card1" ? left : phase === "card2" ? right : null;
    // A clip drives its own timing via `onEnded`; this timer is only the cap
    // that keeps one long contender from stalling the whole match.
    const duration =
      phase === "vs"
        ? VS_MS
        : isVideoItem(item)
          ? MAX_INTRO_CLIP_MS
          : STILL_CARD_MS;

    const timer = window.setTimeout(advance, duration);
    return () => window.clearTimeout(timer);
  }, [phase, left, right, advance]);

  if (phase === "done") {
    return null;
  }

  return (
    // A plain container, not role="button": it holds the unmute control and
    // (under reduced motion) native video controls, and nesting interactive
    // elements inside a button role makes them unreachable. Click-to-skip
    // stays for pointers; the SKIP button below is the accessible path.
    <Box className="bracket-intro-overlay" onClick={skip}>
      <Box className="bracket-intro-stage">
        {phase === "result" && previousResult ? (
          <ResultReveal result={previousResult} />
        ) : null}

        {phase !== "result" ? (
          <IntroCard
            item={left}
            active={phase === "card1"}
            minimized={phase === "card2"}
            showControls={reducedMotion}
            onClipEnded={phase === "card1" ? advance : noop}
            className="bracket-intro-card bracket-intro-card--card1"
          />
        ) : null}

        {phase !== "card1" && phase !== "result" ? (
          <Box className="bracket-intro-vs">
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

        {(phase === "card2" || phase === "both") && right ? (
          <IntroCard
            item={right}
            active={phase === "card2"}
            showControls={reducedMotion}
            onClipEnded={phase === "card2" ? advance : noop}
            className="bracket-intro-card bracket-intro-card--card2"
          />
        ) : null}
      </Box>

      <Box
        component="button"
        type="button"
        className="bracket-intro-skip"
        onClick={(event) => {
          event.stopPropagation();
          skip();
        }}
      >
        SKIP TO VOTING
      </Box>
    </Box>
  );
}
