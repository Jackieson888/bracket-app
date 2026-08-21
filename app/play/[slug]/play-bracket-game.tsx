"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import BracketGame from "@/app/components/bracket-game";
import PillLabel from "@/app/components/pill-label";
import { useUser } from "@/app/user-provider";
import { initialsFor, swatchForIndex } from "@/lib/avatar";
import AvatarGlyph from "@/app/components/avatar-glyph";
import { focusableButtonSx, onActivateKeyDown } from "@/lib/a11y";
import { CheckCircle, ContentCopy } from "@mui/icons-material";

type Session = {
  bracket: unknown;
  slug?: string;
  roomStatus?: string;
  gameState?: RoomState;
  hostParticipantId?: string | null;
  participantLookup?: Record<
    string,
    { participantId: string; displayName?: string; joinedAt?: string | number }
  >;
  [key: string]: unknown;
};

type RoomClient = {
  id: string;
  joinedAt: number;
  displayName?: string;
};

type RoomState = {
  round: number;
  currentMatch: number;
  currentRoundItems: Array<{ id: string; title: string }>;
  matchSize?: number;
  votesByMatch?: Record<string, Record<string, { choice: number; at: number }>>;
  pendingVoteCount: number;
  requiredVoteCount?: number;
  winner?: { id: string; title: string } | null;
  lastWinner?: { id: string; title: string } | null;
  matchDeadline?: number | null;
  // The readiness barrier: the vote window has not started yet, and this is
  // how many of the room's boards are up so far.
  awaitingPlayers?: boolean;
  readyParticipantCount?: number;
  requiredReadyCount?: number;
  matchHistory?: Array<{
    round: number;
    match: number;
    items: Array<{ id: string; title: string }>;
    voteCounts: Record<string, number>;
    winnerItemId: string;
    wasBye: boolean;
  }>;
};

export default function PlayBracketGame({ slug }: { slug: string }) {
  const userContext = useUser();
  const { user } = userContext || { user: null };
  const [session, setSession] = useState<Session | null>(null);
  const [clients, setClients] = useState<RoomClient[]>([]);
  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [roomStatus, setRoomStatus] = useState("waiting");
  const [displayName, setDisplayName] = useState("");
  const [pendingVotes, setPendingVotes] = useState<
    Array<{ round: number; match: number; choice: number }>
  >([]);
  const [connectionError, setConnectionError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionLoading, setSessionLoading] = useState(true);
  const [participantId, setParticipantId] = useState("");
  const [hostParticipantId, setHostParticipantId] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [roomCopied, setRoomCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectAllowedRef = useRef(true);
  const participantStorageKey = `tvt-participant-id:${slug}`;
  const tokenStorageKey = `tvt-participant-token:${slug}`;
  // Written by /play when this tab created the room; redeemed on join so the
  // creator holds the host role however the connection race turns out.
  const hostClaimStorageKey = `tvt-host-claim:${slug}`;
  // Credential for this player slot, returned by the join endpoint. Kept in a
  // ref so the socket "open" handler always reads the latest value.
  const participantTokenRef = useRef<string | null>(null);
  // The socket can be OPEN but not yet verified, and the server drops votes
  // from an unauthenticated socket. Votes are queued until auth-ok lands.
  const socketAuthenticatedRef = useRef(false);
  // Tail of the join queue - see persistJoin.
  const joinChainRef = useRef<Promise<void>>(Promise.resolve());
  // A readiness report the socket was not verified enough to send yet.
  const pendingReadyRef = useRef<{ round: number; match: number } | null>(null);
  // Re-runs the join/auth handshake for the live socket. Set by the socket
  // effect; used by the vote and start paths, which can discover they are
  // unauthenticated long after "open" has come and gone.
  const authenticateRef = useRef<((name: string) => Promise<void>) | null>(
    null,
  );

  useEffect(() => {
    setParticipantId("");
  }, [slug]);

  const resolveParticipantId = () => {
    if (participantId) {
      return participantId;
    }

    const readStoredId = () => {
      try {
        return window.sessionStorage.getItem(participantStorageKey);
      } catch {
        return null;
      }
    };

    const writeStoredId = (value: string) => {
      try {
        window.sessionStorage.setItem(participantStorageKey, value);
        return;
      } catch {
        try {
          window.localStorage.setItem(participantStorageKey, value);
        } catch {
          // Ignore storage failures; in-memory state still works for this tab.
        }
      }
    };

    const existing = readStoredId();
    if (existing) {
      setParticipantId(existing);
      return existing;
    }

    const created = window.crypto.randomUUID();
    writeStoredId(created);
    setParticipantId(created);
    return created;
  };

  const readStoredToken = () => {
    if (participantTokenRef.current) {
      return participantTokenRef.current;
    }
    try {
      const stored =
        window.sessionStorage.getItem(tokenStorageKey) ??
        window.localStorage.getItem(tokenStorageKey);
      participantTokenRef.current = stored;
      return stored;
    } catch {
      return null;
    }
  };

  const writeStoredToken = (value: string) => {
    try {
      window.sessionStorage.setItem(tokenStorageKey, value);
    } catch {
      try {
        window.localStorage.setItem(tokenStorageKey, value);
      } catch {
        // In-memory ref still carries it for this tab.
      }
    }
  };

  const readHostClaim = () => {
    try {
      return window.sessionStorage.getItem(hostClaimStorageKey);
    } catch {
      return null;
    }
  };

  const sendJoin = async (name: string) => {
    const resolvedName = name.trim() || "Guest";
    const resolvedParticipantId = resolveParticipantId();

    const response = await fetch(`/api/sessions/${slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        participantId: resolvedParticipantId,
        displayName: resolvedName,
        participantToken: readStoredToken(),
        hostClaimToken: readHostClaim(),
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to persist player identity for this room");
    }

    const payload = await response.json().catch(() => null);
    if (payload?.participantToken) {
      participantTokenRef.current = payload.participantToken;
      writeStoredToken(payload.participantToken);
    }

    return resolvedParticipantId;
  };

  const persistJoin = (name: string): Promise<string> => {
    // Two joins for the same slot are routinely in flight at once: the
    // socket's open handler registers this player at the same moment the
    // display-name button does. Run in parallel they both post a null token,
    // the first mints one, and the server rejects the second as a takeover of
    // a slot that now has a credential - so the loser either never sends
    // "auth" (an unauthenticated socket whose START GAME is denied) or never
    // saves the player's name. Chaining them means the later call presents
    // the token the earlier one stored.
    const run = () => sendJoin(name);
    const result = joinChainRef.current.then(run, run);
    joinChainRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  useEffect(() => {
    const controller = new AbortController();

    setSessionLoading(true);
    setSessionError("");

    fetch(`/api/sessions/${slug}`, { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) {
          throw new Error("Room not found");
        }

        if (!res.ok) {
          throw new Error("Unable to load this room right now");
        }

        return res.json();
      })
      .then((data: Session) => {
        setSession(data);
        if (data.roomStatus) {
          setRoomStatus(data.roomStatus);
        }
        if (data.gameState) {
          setRoomState(data.gameState);
        }
        if (data.hostParticipantId) {
          setHostParticipantId(data.hostParticipantId);
        }
        if (data.participantLookup) {
          const hydratedClients = Object.values(data.participantLookup)
            .map((entry) => ({
              id: entry.participantId,
              displayName: entry.displayName || "Guest",
              joinedAt: entry.joinedAt
                ? new Date(entry.joinedAt).getTime()
                : Date.now(),
            }))
            .sort((left, right) => left.joinedAt - right.joinedAt);
          if (hydratedClients.length > 0) {
            setClients(hydratedClients);
          }
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        console.error(error);
        setSession(null);
        setSessionError(error?.message || "Unable to load room");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSessionLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  useEffect(() => {
    const derivedName =
      (user as { name?: string; nickname?: string; email?: string } | null)
        ?.name ??
      (user as { name?: string; nickname?: string; email?: string } | null)
        ?.nickname ??
      (user as { name?: string; nickname?: string; email?: string } | null)
        ?.email ??
      "";

    setDisplayName(derivedName);
  }, [user]);

  useEffect(() => {
    if (!slug) {
      return;
    }

    reconnectAllowedRef.current = true;
    const resolvedParticipantId = resolveParticipantId();
    const resolvedName = (displayName || "Guest").trim() || "Guest";

    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const configuredWsBaseUrl = process.env.NEXT_PUBLIC_WS_URL?.trim() || "";
    const MAX_RECONNECT_ATTEMPTS = 3;
    const CONNECT_TIMEOUT_MS = 6000;
    const AUTH_ATTEMPTS = 3;
    const AUTH_RETRY_DELAY_MS = 400;
    let isUnmounted = false;
    let openTimeoutHandle: number | null = null;
    let reconnectTimeoutHandle: number | null = null;
    let activeSocket: WebSocket | null = null;

    const clearHandles = () => {
      if (openTimeoutHandle !== null) {
        window.clearTimeout(openTimeoutHandle);
        openTimeoutHandle = null;
      }

      if (reconnectTimeoutHandle !== null) {
        window.clearTimeout(reconnectTimeoutHandle);
        reconnectTimeoutHandle = null;
      }
    };

    const scheduleReconnect = () => {
      if (isUnmounted || !reconnectAllowedRef.current) {
        return;
      }

      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionError(
          "Real-time connection lost. Please refresh to reconnect to this room.",
        );
        return;
      }

      reconnectAttemptRef.current += 1;
      const attempt = reconnectAttemptRef.current;
      const retryDelayMs = Math.min(300 * attempt, 1000);
      setConnectionError(
        `Reconnecting to room... attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`,
      );
      reconnectTimeoutHandle = window.setTimeout(() => {
        connectSocket();
      }, retryDelayMs);
    };

    const connectSocket = () => {
      if (isUnmounted || !reconnectAllowedRef.current) {
        return;
      }

      setConnected(false);
      let wsUrl: URL;

      if (configuredWsBaseUrl) {
        const normalizedBase = configuredWsBaseUrl.replace(/\/+$/, "");
        const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalizedBase);
        const configuredUrl = new URL(
          hasScheme
            ? normalizedBase
            : `${window.location.protocol}//${normalizedBase}`,
        );
        let configuredProtocol =
          configuredUrl.protocol === "https:"
            ? "wss:"
            : configuredUrl.protocol === "http:"
              ? "ws:"
              : configuredUrl.protocol;

        if (
          window.location.protocol === "https:" &&
          configuredProtocol === "ws:"
        ) {
          configuredProtocol = "wss:";
        }

        wsUrl = new URL(`${configuredProtocol}//${configuredUrl.host}/ws`);
      } else {
        wsUrl = new URL(`${wsProtocol}://${window.location.host}/ws`);
      }

      wsUrl.searchParams.set("slug", slug);
      wsUrl.searchParams.set("participantId", resolvedParticipantId);
      wsUrl.searchParams.set("displayName", resolvedName);

      const nextSocket = new WebSocket(wsUrl.toString());
      let didScheduleRetry = false;

      activeSocket = nextSocket;
      setSocket(nextSocket);

      openTimeoutHandle = window.setTimeout(() => {
        if (isUnmounted) {
          return;
        }

        nextSocket.close();
      }, CONNECT_TIMEOUT_MS);

      // A socket that never presents its token is not a spectator with a
      // cosmetic problem: the server drops its votes, leaves it out of the
      // quorum, and hands the host role to whoever authenticated first. A
      // single failed join used to wedge a player there for the whole game,
      // so this retries, and stays callable for anything that later finds
      // itself unauthenticated.
      const authenticate = async (name: string) => {
        for (let attempt = 1; attempt <= AUTH_ATTEMPTS; attempt += 1) {
          try {
            await persistJoin(name);
            const token = participantTokenRef.current;
            if (!token || nextSocket.readyState !== WebSocket.OPEN) {
              return;
            }

            nextSocket.send(
              JSON.stringify({
                type: "auth",
                participantId: resolvedParticipantId,
                participantToken: token,
              }),
            );
            return;
          } catch (error) {
            console.error("Failed to persist room join:", error);
            if (isUnmounted || nextSocket.readyState !== WebSocket.OPEN) {
              return;
            }
            if (attempt === AUTH_ATTEMPTS) {
              setConnectionError(
                "Could not verify you for this room, so your votes will not count. Please refresh.",
              );
              return;
            }
            await new Promise((resolve) => {
              window.setTimeout(resolve, AUTH_RETRY_DELAY_MS * attempt);
            });
          }
        }
      };

      authenticateRef.current = (name) => authenticate(name);

      nextSocket.addEventListener("open", () => {
        if (isUnmounted) {
          return;
        }

        reconnectAttemptRef.current = 0;
        if (openTimeoutHandle !== null) {
          window.clearTimeout(openTimeoutHandle);
          openTimeoutHandle = null;
        }

        setConnected(true);
        setConnectionError("");
        socketAuthenticatedRef.current = false;

        nextSocket.send(
          JSON.stringify({
            type: "join",
            slug,
            displayName: resolvedName,
            participantId: resolvedParticipantId,
          }),
        );

        // The socket cannot vote or start the game until it presents the
        // credential from the join endpoint, so register first and only then
        // authenticate this connection.
        void authenticate(resolvedName);
      });

      nextSocket.addEventListener("message", (event) => {
        try {
          const payload =
            typeof event.data === "string"
              ? JSON.parse(event.data)
              : JSON.parse(String(event.data));

          if (payload?.type === "auth-ok") {
            socketAuthenticatedRef.current = true;
            setConnectionError("");

            const heldReady = pendingReadyRef.current;
            if (heldReady) {
              pendingReadyRef.current = null;
              nextSocket.send(
                JSON.stringify({ type: "ready", slug, ...heldReady }),
              );
            }

            setPendingVotes((current) => {
              if (current.length === 0) {
                return current;
              }

              const queuedVotes = [...current];
              setTimeout(() => {
                queuedVotes.forEach((vote) => {
                  nextSocket.send(
                    JSON.stringify({
                      type: "vote",
                      slug,
                      playerId: resolvedParticipantId,
                      ...vote,
                    }),
                  );
                });
              }, 0);

              return [];
            });
          }

          if (payload?.type === "vote-denied") {
            // The server and this client disagree about whether the socket is
            // verified. Believe the server, requeue the vote, and re-present
            // the token - auth-ok flushes the queue.
            socketAuthenticatedRef.current = false;
            if (payload.vote) {
              setPendingVotes((current) => [...current, payload.vote]);
            }
            setConnectionError("Verifying your player identity. Your vote is queued.");
            void authenticate(resolvedName);
          }

          if (payload?.type === "auth-denied") {
            socketAuthenticatedRef.current = false;
            setConnectionError(
              "Could not verify your player identity for this room.",
            );
          }

          if (payload?.type === "room-state") {
            const nextClients = Array.isArray(payload.clients)
              ? [...payload.clients].sort(
                  (left: RoomClient, right: RoomClient) =>
                    left.joinedAt - right.joinedAt,
                )
              : [];
            setClients(nextClients);
            setRoomStatus(payload.roomStatus ?? "waiting");
            if (payload.gameState) {
              setRoomState(payload.gameState);
            }
            if (payload.hostParticipantId) {
              setHostParticipantId(payload.hostParticipantId);
            }
          }

          if (payload?.type === "game-started") {
            setStartLoading(false);
            setRoomStatus(payload.roomStatus ?? "started");
            setRoomState(payload.gameState);
          }

          if (
            payload?.type === "vote-update" ||
            payload?.type === "game-sync"
          ) {
            setRoomStatus((current) => payload.roomStatus ?? current);
            setRoomState(payload.gameState);
          }

          if (payload?.type === "room-expired") {
            reconnectAllowedRef.current = false;
            setJoinLoading(false);
            setStartLoading(false);
            setRoomStatus("expired");
            setRoomState(null);
            setConnectionError(
              payload?.message || "This room has expired. Start a new one.",
            );
            nextSocket.close();
          }

          if (payload?.type === "room-locked") {
            reconnectAllowedRef.current = false;
            setJoinLoading(false);
            setStartLoading(false);
            setConnectionError(
              payload?.message ||
                "This game has already started and new players cannot join.",
            );
            nextSocket.close();
          }

          if (payload?.type === "start-denied") {
            setStartLoading(false);
            setConnectionError(
              payload?.message || "Only the room host can start the game.",
            );
            // A start refused because the socket is unverified is recoverable:
            // present the token again so the next tap works.
            if (payload?.unverified) {
              socketAuthenticatedRef.current = false;
              void authenticate(resolvedName);
            }
          }
        } catch (error) {
          console.error("Error reading room state", error);
        }
      });

      nextSocket.addEventListener("close", () => {
        if (openTimeoutHandle !== null) {
          window.clearTimeout(openTimeoutHandle);
          openTimeoutHandle = null;
        }

        socketAuthenticatedRef.current = false;

        if (isUnmounted) {
          return;
        }

        setConnected(false);
        setJoinLoading(false);
        setStartLoading(false);

        if (reconnectAllowedRef.current && !didScheduleRetry) {
          didScheduleRetry = true;
          scheduleReconnect();
        }
      });

      nextSocket.addEventListener("error", () => {
        if (isUnmounted || didScheduleRetry || !reconnectAllowedRef.current) {
          return;
        }

        didScheduleRetry = true;
        scheduleReconnect();
      });
    };

    reconnectAttemptRef.current = 0;
    connectSocket();

    return () => {
      isUnmounted = true;
      reconnectAllowedRef.current = false;
      authenticateRef.current = null;
      clearHandles();
      activeSocket?.close();
      setSocket(null);
    };
  }, [slug]);

  const isHost = Boolean(
    participantId && hostParticipantId && participantId === hostParticipantId,
  );

  const handleStartGame = () => {
    if (!isHost) {
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setConnectionError("Waiting for real-time connection before starting.");
      return;
    }

    const items =
      (
        session?.bracket as {
          items?: Array<{ id: string; title: string }>;
        }
      )?.items ?? [];

    if (items.length === 0) {
      setConnectionError("This bracket has no items and cannot be started.");
      return;
    }

    setStartLoading(true);
    setConnectionError("");
    socket.send(
      JSON.stringify({
        type: "start-game",
        slug,
        currentRoundItems: items,
      }),
    );
  };

  const handleJoinRoom = async () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setConnectionError("Waiting for real-time connection before joining.");
      return;
    }

    const resolvedName = displayName.trim() || "Guest";
    const resolvedParticipantId = resolveParticipantId();
    setDisplayName(resolvedName);
    setJoinLoading(true);
    setConnectionError("");

    try {
      await persistJoin(resolvedName);
      socket.send(
        JSON.stringify({
          type: "join",
          slug,
          displayName: resolvedName,
          participantId: resolvedParticipantId,
        }),
      );
    } catch (error) {
      console.error("Failed to persist room join:", error);
      setConnectionError("Could not update your player name right now.");
    } finally {
      setJoinLoading(false);
    }
  };

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(slug);
      setRoomCopied(true);
      window.setTimeout(() => {
        setRoomCopied(false);
      }, 1400);
    } catch {
      setConnectionError(
        "Could not copy room code. You can still share it manually.",
      );
    }
  };

  const handleCopyJoinLink = async () => {
    const joinUrl = `${window.location.origin}/play/${slug}`;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      window.prompt("Copy this join link:", joinUrl);
    }
  };

  // Sent when the board for a matchup is actually on screen here. useCallback
  // because the board fires this from an effect - an unstable prop would
  // report readiness again on every parent render.
  const handleReady = useCallback(
    (payload: { round: number; match: number }) => {
      if (
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        !socketAuthenticatedRef.current
      ) {
        // The board can be up before this socket has finished verifying.
        // Hold the report and let auth-ok send it, or the room would wait out
        // the whole grace period on a player who is already looking at it.
        pendingReadyRef.current = payload;
        return;
      }

      pendingReadyRef.current = null;
      socket.send(JSON.stringify({ type: "ready", slug, ...payload }));
    },
    [slug, socket],
  );

  const handleVote = (payload: {
    round: number;
    match: number;
    choice: number;
  }) => {
    if (!socket) {
      return;
    }

    if (
      socket.readyState !== WebSocket.OPEN ||
      !socketAuthenticatedRef.current
    ) {
      setConnectionError("Still connecting. Your vote is queued.");
      setPendingVotes((current) => [...current, payload]);
      // The queue is only ever flushed by auth-ok, so a socket that is open
      // but unverified would sit on these votes for the rest of the game.
      if (socket.readyState === WebSocket.OPEN) {
        void authenticateRef.current?.(displayName || "Guest");
      }
      return;
    }

    socket.send(
      JSON.stringify({
        type: "vote",
        slug,
        playerId: resolveParticipantId(),
        ...payload,
      }),
    );
  };

  const joinedLabel = useMemo(() => {
    return clients.length === 1
      ? "1 PLAYER CONNECTED"
      : `${clients.length} PLAYERS CONNECTED`;
  }, [clients.length]);

  const hasGameStarted =
    roomStatus === "started" ||
    roomStatus === "completed" ||
    Boolean(roomState?.currentRoundItems?.length);

  const roomExpired = roomStatus === "expired";
  const canUseSocket = Boolean(socket && socket.readyState === WebSocket.OPEN);

  if (sessionLoading) {
    return (
      <Box
        sx={{
          p: 3,
          display: "flex",
          alignItems: "center",
          gap: { xs: 1.75, sm: 2.25 },
          justifyContent: "center",
        }}
      >
        <CircularProgress size={20} />
        <Typography>Loading session...</Typography>
      </Box>
    );
  }

  if (sessionError) {
    return (
      <Box
        sx={{
          p: { xs: 1.75, sm: 2.25 },
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Alert severity="error">{sessionError}</Alert>
        <Button href="/play" variant="contained">
          Back to Play
        </Button>
      </Box>
    );
  }

  if (!session || !session.bracket) {
    return (
      <Box
        sx={{
          p: { xs: 1.75, sm: 2.25 },
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Alert severity="error">This room is unavailable.</Alert>
        <Button href="/play" variant="contained">
          Back to Play
        </Button>
      </Box>
    );
  }

  if (roomExpired) {
    return (
      <Box
        sx={{
          p: { xs: 1.75, sm: 2.25 },
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Alert severity="error">
          This bracket session expired after 30 minutes.
        </Alert>
        <Button href="/play" variant="contained">
          Back to Play
        </Button>
      </Box>
    );
  }

  return (
    <>
      {!hasGameStarted ? (
        <Box
          className="bracket-shell"
          sx={{
            padding: "24px 18px 28px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          <Box className="bracket-pop-in" sx={{ textAlign: "center" }}>
            <Typography
              component="h1"
              sx={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "26px",
                letterSpacing: "1px",
                color: "var(--accent)",
                textShadow: "0 0 18px rgba(var(--accent-rgb),0.3)",
              }}
            >
              WAITING ROOM
            </Typography>
          </Box>

          {/* Scanning beats typing a code on a phone, which is the slowest
              step in getting a group into a room. */}
          <Box className="bracket-join-panel bracket-pop-in">
            <Box className="bracket-join-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/sessions/${slug}/qr`}
                alt={`QR code to join room ${slug}`}
                width={148}
                height={148}
              />
            </Box>
            <Box className="bracket-join-detail">
              <Typography className="bracket-join-label">SCAN TO JOIN</Typography>
              <Typography className="bracket-join-code">{slug}</Typography>
              <Box
                component="button"
                type="button"
                className="bracket-join-link"
                onClick={handleCopyJoinLink}
              >
                {linkCopied ? "LINK COPIED" : "COPY JOIN LINK"}
              </Box>
            </Box>
          </Box>

          <Box
            className="bracket-pop-in"
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <Box
              role="button"
              tabIndex={0}
              aria-label={roomCopied ? "Room code copied" : "Copy room code"}
              onClick={handleCopyRoomCode}
              onKeyDown={onActivateKeyDown(handleCopyRoomCode)}
              sx={{
                ...focusableButtonSx,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                borderRadius: "999px",
                backgroundColor: "rgba(var(--primary-rgb),0.15)",
                border: "1px solid rgba(var(--primary-rgb),0.3)",
              }}
            >
              <Typography
                sx={{
                  fontFamily: "var(--font-mono-ui)",
                  fontSize: "15px",
                  letterSpacing: "3px",
                  color: "var(--primary)",
                  fontWeight: 700,
                }}
              >
                {slug}
              </Typography>
              {roomCopied ? (
                <CheckCircle sx={{ fontSize: 14, color: "var(--secondary)" }} />
              ) : (
                <ContentCopy sx={{ fontSize: 13, color: "var(--primary)" }} />
              )}
            </Box>
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
              <Box className="bracket-synced-dot" sx={{ backgroundColor: "var(--secondary)" }} />
              <Typography
                sx={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "11px",
                  letterSpacing: "1.5px",
                  color: "text.secondary",
                }}
              >
                {joinedLabel}
              </Typography>
            </Box>
          </Box>

          <Box className="bracket-pop-in" sx={{ position: "relative" }}>
            <PillLabel>DISPLAY NAME</PillLabel>
            <Box
              sx={{
                backgroundColor: "var(--card-elevated)",
                borderRadius: "18px",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "20px 16px 16px",
                display: "flex",
                alignItems: "stretch",
                gap: "12px",
              }}
            >
              <Box
                component="input"
                value={displayName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDisplayName(e.target.value)
                }
                placeholder="Guest"
                aria-label="Display name"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: "none",
                  outline: "2px solid transparent",
                  outlineOffset: "2px",
                  "&:focus-visible": {
                    outline: "2px solid var(--primary)",
                  },
                  borderBottom: "2px solid rgba(var(--primary-rgb),0.4)",
                  paddingBottom: "8px",
                  fontFamily: "var(--font-body)",
                  fontWeight: 600,
                  fontSize: "16px",
                  color: "text.primary",
                }}
              />
              <Box
                role="button"
                tabIndex={0}
                aria-label="Update display name"
                onClick={() => {
                  if (canUseSocket && !joinLoading && !startLoading) {
                    void handleJoinRoom();
                  }
                }}
                onKeyDown={onActivateKeyDown(() => {
                  if (canUseSocket && !joinLoading && !startLoading) {
                    void handleJoinRoom();
                  }
                })}
                sx={{
                  ...focusableButtonSx,
                  cursor: canUseSocket && !joinLoading && !startLoading ? "pointer" : "default",
                  opacity: canUseSocket && !joinLoading && !startLoading ? 1 : 0.5,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 16px",
                  borderRadius: "12px",
                  backgroundColor: "var(--tertiary)",
                }}
              >
                <Typography
                  sx={{
                    fontFamily: "var(--font-heading)",
                    fontSize: "12px",
                    letterSpacing: "1.5px",
                    color: "var(--card)",
                  }}
                >
                  {joinLoading ? "SAVING..." : "UPDATE"}
                </Typography>
              </Box>
            </Box>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Typography
              sx={{
                fontFamily: "var(--font-heading)",
                fontSize: "12px",
                letterSpacing: "2px",
                color: "text.secondary",
                pl: "2px",
              }}
            >
              ROSTER · {clients.length}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {clients.map((client, idx) => (
                <Box
                  key={client.id}
                  sx={{
                    animation: "avatarPop 180ms ease-out both",
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "7px 12px 7px 7px",
                    borderRadius: "999px",
                    backgroundColor: "var(--card-elevated)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <Box
                    sx={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      backgroundColor: swatchForIndex(idx),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-heading)",
                      fontSize: "10px",
                      color: "var(--card)",
                      flexShrink: 0,
                    }}
                  >
                    <AvatarGlyph initials={initialsFor(client.displayName)} size={12} />
                  </Box>
                  <Typography
                    sx={{
                      fontFamily: "var(--font-body)",
                      fontWeight: 600,
                      fontSize: "13px",
                      color: "text.primary",
                    }}
                  >
                    {client.displayName || "Guest"}
                  </Typography>
                  {hostParticipantId && client.id === hostParticipantId ? (
                    <Typography
                      sx={{
                        fontFamily: "var(--font-heading)",
                        fontSize: "9px",
                        letterSpacing: "1px",
                        color: "var(--accent)",
                      }}
                    >
                      HOST
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          </Box>

          {pendingVotes.length > 0 ? (
            <Typography
              sx={{
                fontFamily: "var(--font-heading)",
                fontSize: "11px",
                letterSpacing: "1.5px",
                color: "text.secondary",
                textAlign: "center",
              }}
            >
              {pendingVotes.length} QUEUED VOTE{pendingVotes.length > 1 ? "S" : ""}
            </Typography>
          ) : null}

          {isHost ? (
            <Box
              role="button"
              tabIndex={0}
              onClick={() => {
                if (canUseSocket && !startLoading) {
                  handleStartGame();
                }
              }}
              onKeyDown={onActivateKeyDown(() => {
                if (canUseSocket && !startLoading) {
                  handleStartGame();
                }
              })}
              className="bracket-glow-pulse"
              sx={{
                ...focusableButtonSx,
                cursor: canUseSocket && !startLoading ? "pointer" : "default",
                opacity: canUseSocket && !startLoading ? 1 : 0.6,
                textAlign: "center",
                padding: "16px",
                borderRadius: "16px",
                backgroundColor: "var(--accent)",
                mt: "4px",
              }}
            >
              <Typography
                sx={{
                  fontFamily: "var(--font-display)",
                  fontSize: "17px",
                  letterSpacing: "1px",
                  color: "var(--card)",
                }}
              >
                {startLoading ? "STARTING..." : "START GAME"}
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                textAlign: "center",
                padding: "16px",
                borderRadius: "16px",
                border: "1.5px dashed var(--sub)",
                mt: "4px",
              }}
            >
              <Box
                sx={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "var(--sub)",
                  animation: "pulseSoft 1.6s ease-in-out infinite",
                }}
              />
              <Typography
                sx={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "13px",
                  letterSpacing: "1.5px",
                  color: "text.secondary",
                }}
              >
                WAITING FOR HOST TO START...
              </Typography>
            </Box>
          )}
        </Box>
      ) : null}

      {hasGameStarted ? (
        <BracketGame
          bracket={
            session.bracket as {
              _id?: string;
              items?: Array<{ id: string; title: string }>;
            }
          }
          slug={slug}
          connected={connected}
          participants={Object.fromEntries(
            clients.map((client) => [client.id, client.displayName || "Guest"]),
          )}
          roomState={roomState ?? undefined}
          onVote={handleVote}
          onReady={handleReady}
          onPlayAgain={handleStartGame}
          isHost={isHost}
          playerCount={Math.max(1, clients.length)}
        />
      ) : null}

      {connectionError ? (
        <Alert severity="warning" sx={{ mt: 0.75 }}>
          {connectionError}
        </Alert>
      ) : null}
    </>
  );
}
