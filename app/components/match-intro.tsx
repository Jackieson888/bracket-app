"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
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
  width?: number;
  height?: number;
};

type Phase = "result" | "card1" | "vs" | "card2" | "both" | "done";

// The server's match history only stores an id and a title per contender, so
// the board fills the media back in from the bracket before handing the result
// over - the reveal is meant to show the clip that won, not just its name.
export type MatchResult = {
  items: Array<
    { id: string; title: string } & Pick<
      IntroItem,
      "url" | "mediaType" | "duration" | "width" | "height"
    >
  >;
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
// How long a clip gets to actually start before the sequence gives up on it.
// Without this a blocked or stalled clip holds the overlay for the full
// MAX_INTRO_CLIP_MS cap on a frozen poster frame.
const CLIP_START_TIMEOUT_MS = 4000;
// Overlap between the overlay fading out and the board underneath animating
// in, so the two screens cross rather than cut.
const EXIT_MS = 260;

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
  onAspect,
}: {
  item: IntroItem;
  active: boolean;
  showControls: boolean;
  onEnded: () => void;
  onAspect: (aspect: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const transcodedSrc = videoSourceUrl(item.url) ?? item.url;
  // Falls back to the stored original if the mp4 rendition will not load, so a
  // missing or still-generating Cloudinary derivative costs a retry rather
  // than the whole clip. Recording which rendition failed - rather than the
  // url to use - means a new clip resets the choice without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = failedSrc === transcodedSrc ? item.url : transcodedSrc;
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
    let started = false;
    let audibleRefused = false;

    const attempt = async () => {
      // `canplay` can fire repeatedly; re-entering while the clip is already
      // running would reset the muted state chosen below.
      if (cancelled || !video.paused) {
        return;
      }

      if (!audibleRefused) {
        try {
          video.muted = false;
          await video.play();
          return;
        } catch {
          // Audible autoplay refused: no qualifying user gesture yet.
          audibleRefused = true;
        }
      }

      if (cancelled) {
        return;
      }

      try {
        video.muted = true;
        setSoundBlocked(true);
        await video.play();
      } catch {
        // Not startable yet. `canplay` retries when data lands, and the
        // watchdog moves the intro on if it never does.
      }
    };

    const markStarted = () => {
      started = true;
    };

    video.addEventListener("playing", markStarted);
    video.addEventListener("canplay", attempt);
    void attempt();

    // A clip that never starts - blocked, stalled, or still transcoding -
    // used to hold the overlay for the full 30s cap on a frozen poster.
    const watchdog = window.setTimeout(() => {
      if (!cancelled && !started) {
        onEndedRef.current();
      }
    }, CLIP_START_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      video.removeEventListener("playing", markStarted);
      video.removeEventListener("canplay", attempt);
    };
  }, [src, active]);

  const handleError = () => {
    if (transcodedSrc && item.url && src !== item.url) {
      setFailedSrc(transcodedSrc);
      return;
    }

    onEndedRef.current();
  };

  const handleUnmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setSoundBlocked(false);
    void video.play().catch(() => {});
  };

  return (
    <Box
      sx={{
        position: "relative",
        display: "flex",
        justifyContent: "center",
        // Fills the frame so the clip's own 100% sizing has something
        // definite to resolve against.
        width: "100%",
        height: "100%",
        minHeight: 0,
      }}
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
        onLoadedMetadata={(event) => {
          const { videoWidth, videoHeight } = event.currentTarget;
          if (videoWidth > 0 && videoHeight > 0) {
            onAspect(videoWidth / videoHeight);
          }
        }}
        onEnded={() => onEndedRef.current()}
        onError={handleError}
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

  // The frame takes the media's own shape, which is what stops a 16:9 clip
  // floating in a tall dark box while it has the stage to itself. Uploads
  // carry their dimensions; anything older measures itself once it loads.
  const declaredAspect =
    item.width && item.height ? item.width / item.height : null;
  const [measuredAspect, setMeasuredAspect] = useState<number | null>(null);
  const aspect = declaredAspect ?? measuredAspect;

  return (
    <Box className={className} data-minimized={minimized ? "true" : undefined}>
      <Box className="bracket-intro-card-inner">
        <Box
          className="bracket-intro-media-frame"
          data-fit={aspect ? "known" : undefined}
          style={
            aspect
              ? ({ "--intro-media-aspect": `${aspect}` } as CSSProperties)
              : undefined
          }
        >
          {isVideo ? (
            <IntroClip
              item={item}
              active={active}
              showControls={showControls}
              onEnded={onClipEnded}
              onAspect={setMeasuredAspect}
            />
          ) : stillUrl ? (
            <Image
              className="bracket-intro-media"
              src={stillUrl}
              alt={item.title}
              width={980}
              height={620}
              sizes="(max-width: 640px) 100vw, 980px"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setMeasuredAspect(naturalWidth / naturalHeight);
                }
              }}
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

// The winning clip, replayed for the couple of seconds the result is up.
// Muted and looping: the next contender's clip starts the moment this ends, so
// two soundtracks must never overlap, and muted playback is the only kind that
// starts reliably without a fresh user gesture.
function ResultClip({ item }: { item: MatchResult["items"][number] }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The clip still plays - it is the result, not decoration - but it plays
  // once instead of looping for anyone who asked for less movement.
  const reducedMotion = usePrefersReducedMotion();
  const isVideo = isVideoItem(item);
  const still = previewImageUrl(item);
  const src = isVideo ? (videoSourceUrl(item.url) ?? item.url) : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    void video.play().catch(() => {
      // Blocked or still transcoding: the poster frame carries the moment.
    });
  }, [src]);

  if (isVideo && src) {
    return (
      <video
        ref={videoRef}
        className="bracket-reveal-media"
        src={src}
        poster={still ?? undefined}
        muted
        loop={!reducedMotion}
        controls={reducedMotion}
        playsInline
        preload="auto"
        aria-label={`Winning clip: ${item.title}`}
      />
    );
  }

  if (!still) {
    return null;
  }

  return (
    <Image
      className="bracket-reveal-media"
      src={still}
      alt={item.title}
      width={item.width ?? 640}
      height={item.height ?? 360}
      sizes="(max-width: 640px) 100vw, 520px"
    />
  );
}

function ResultReveal({ result }: { result: MatchResult }) {
  const total = Object.values(result.voteCounts).reduce((a, b) => a + b, 0);
  const winner = result.items.find((item) => item.id === result.winnerItemId);

  return (
    <Box className="bracket-reveal">
      <Typography className="bracket-reveal-label">LAST MATCH</Typography>
      {winner?.url ? (
        <Box className="bracket-reveal-stage">
          <ResultClip item={winner} />
          <Box className="bracket-reveal-winner-tag">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="m5 13 4 4L19 7"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            WINNER
          </Box>
        </Box>
      ) : null}
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
  onRevealBoard,
  onComplete,
}: {
  left: IntroItem;
  right?: IntroItem | null;
  previousResult?: MatchResult | null;
  // Fires as the overlay starts fading, so the board mounts and plays its own
  // entrance underneath rather than appearing after a hard cut.
  onRevealBoard: () => void;
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

  const onRevealBoardRef = useRef(onRevealBoard);
  useEffect(() => {
    onRevealBoardRef.current = onRevealBoard;
  }, [onRevealBoard]);

  useEffect(() => {
    if (phase === "done") {
      // Reveal first, unmount after the fade: for one beat the board is
      // animating in underneath a dissolving overlay.
      onRevealBoardRef.current();

      if (reducedMotion) {
        onCompleteRef.current();
        return;
      }

      const exitTimer = window.setTimeout(
        () => onCompleteRef.current(),
        EXIT_MS,
      );
      return () => window.clearTimeout(exitTimer);
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
  }, [phase, left, right, advance, reducedMotion]);

  const closing = phase === "done";
  // The overlay stays mounted through its fade, so the stage holds the final
  // "both contenders" frame rather than dropping the second card mid-dissolve.
  const stagePhase: Phase = closing ? "both" : phase;

  return (
    // A plain container, not role="button": it holds the unmute control and
    // (under reduced motion) native video controls, and nesting interactive
    // elements inside a button role makes them unreachable. Click-to-skip
    // stays for pointers; the SKIP button below is the accessible path.
    <Box
      className={`bracket-intro-overlay${closing ? " bracket-intro-overlay--closing" : ""}`}
      aria-hidden={closing || undefined}
      onClick={closing ? undefined : skip}
    >
      <Box className="bracket-intro-stage">
        {stagePhase === "result" && previousResult ? (
          <ResultReveal result={previousResult} />
        ) : null}

        {stagePhase !== "result" ? (
          <IntroCard
            item={left}
            active={stagePhase === "card1"}
            minimized={stagePhase === "card2"}
            showControls={reducedMotion}
            onClipEnded={stagePhase === "card1" ? advance : noop}
            className="bracket-intro-card bracket-intro-card--card1"
          />
        ) : null}

        {stagePhase !== "card1" && stagePhase !== "result" ? (
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

        {(stagePhase === "card2" || stagePhase === "both") && right ? (
          <IntroCard
            item={right}
            active={stagePhase === "card2"}
            showControls={reducedMotion}
            onClipEnded={stagePhase === "card2" ? advance : noop}
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
