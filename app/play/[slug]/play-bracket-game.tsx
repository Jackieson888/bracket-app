"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import BracketGame from "@/app/components/bracket-game";
import PillLabel from "@/app/components/pill-label";
import { useUser } from "@/app/user-provider";
import { initialsFor, swatchForIndex } from "@/lib/avatar";
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
  currentRoundItems: Array<{ _id: string; title: string }>;
  matchSize?: number;
  votesByMatch?: Record<string, Record<string, { choice: number; at: number }>>;
  pendingVoteCount: number;
  requiredVoteCount?: number;
  winner?: { _id: string; title: string } | null;
  lastWinner?: { _id: string; title: string } | null;
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
  const [connectTimeMs, setConnectTimeMs] = useState<number | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [sessionLoading, setSessionLoading] = useState(true);
  const [participantId, setParticipantId] = useState("");
  const [hostParticipantId, setHostParticipantId] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [roomCopied, setRoomCopied] = useState(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectAllowedRef = useRef(true);
  const participantStorageKey = `tvt-participant-id:${slug}`;

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

  const persistJoin = async (name: string) => {
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
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to persist player identity for this room");
    }

    return resolvedParticipantId;
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
      const connectionStart = Date.now();
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
        setConnectTimeMs(Date.now() - connectionStart);

        nextSocket.send(
          JSON.stringify({
            type: "join",
            slug,
            displayName: resolvedName,
            participantId: resolvedParticipantId,
          }),
        );

        void persistJoin(resolvedName).catch((error) => {
          console.error("Failed to persist room join:", error);
          setConnectionError("Connected, but could not save your player name.");
        });

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
      });

      nextSocket.addEventListener("message", (event) => {
        try {
          const payload =
            typeof event.data === "string"
              ? JSON.parse(event.data)
              : JSON.parse(String(event.data));

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
          items?: Array<{ _id: string; title: string }>;
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

  const handleVote = (payload: {
    round: number;
    match: number;
    choice: number;
  }) => {
    if (!socket) {
      return;
    }

    if (socket.readyState !== WebSocket.OPEN) {
      setConnectionError("Connection interrupted. Vote queued for resend.");
      setPendingVotes((current) => [...current, payload]);
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
              sx={{
                fontFamily: "var(--font-display)",
                fontSize: "26px",
                letterSpacing: "1px",
                color: "var(--peach)",
                textShadow: "0 0 18px rgba(240,198,159,0.3)",
              }}
            >
              WAITING ROOM
            </Typography>
            <Typography
              sx={{
                fontFamily: "var(--font-heading)",
                fontSize: "12px",
                letterSpacing: "3px",
                color: "text.secondary",
                mt: "3px",
              }}
            >
              SET YOUR NAME, THEN GET READY
            </Typography>
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
              aria-label={roomCopied ? "Room code copied" : "Copy room code"}
              onClick={handleCopyRoomCode}
              sx={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                borderRadius: "999px",
                backgroundColor: "rgba(230,163,184,0.15)",
                border: "1px solid rgba(230,163,184,0.3)",
              }}
            >
              <Typography
                sx={{
                  fontFamily: "var(--font-mono-ui)",
                  fontSize: "15px",
                  letterSpacing: "3px",
                  color: "var(--pink)",
                  fontWeight: 700,
                }}
              >
                {slug}
              </Typography>
              {roomCopied ? (
                <CheckCircle sx={{ fontSize: 14, color: "var(--teal)" }} />
              ) : (
                <ContentCopy sx={{ fontSize: 13, color: "var(--pink)" }} />
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
              <Box className="bracket-synced-dot" sx={{ backgroundColor: "var(--teal)" }} />
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
                sx={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  borderBottom: "2px solid rgba(230,163,184,0.4)",
                  paddingBottom: "8px",
                  fontFamily: "var(--font-body)",
                  fontWeight: 600,
                  fontSize: "16px",
                  color: "text.primary",
                }}
              />
              <Box
                role="button"
                onClick={() => {
                  if (canUseSocket && !joinLoading && !startLoading) {
                    void handleJoinRoom();
                  }
                }}
                sx={{
                  cursor: canUseSocket && !joinLoading && !startLoading ? "pointer" : "default",
                  opacity: canUseSocket && !joinLoading && !startLoading ? 1 : 0.5,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 16px",
                  borderRadius: "12px",
                  backgroundColor: "var(--lav)",
                }}
              >
                <Typography
                  sx={{
                    fontFamily: "var(--font-heading)",
                    fontSize: "12px",
                    letterSpacing: "1.5px",
                    color: "#241c34",
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
                      color: "#241c34",
                      flexShrink: 0,
                    }}
                  >
                    {initialsFor(client.displayName || "Guest")}
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
                        color: "var(--peach)",
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
              onClick={() => {
                if (canUseSocket && !startLoading) {
                  handleStartGame();
                }
              }}
              className="bracket-glow-pulse"
              sx={{
                cursor: canUseSocket && !startLoading ? "pointer" : "default",
                opacity: canUseSocket && !startLoading ? 1 : 0.6,
                textAlign: "center",
                padding: "16px",
                borderRadius: "16px",
                backgroundColor: "var(--peach)",
                mt: "4px",
              }}
            >
              <Typography
                sx={{
                  fontFamily: "var(--font-display)",
                  fontSize: "17px",
                  letterSpacing: "1px",
                  color: "#241c34",
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
            session.bracket as { items?: Array<{ _id: string; title: string }> }
          }
          slug={slug}
          session={session}
          connected={connected}
          connectTimeMs={connectTimeMs ?? undefined}
          participants={Object.fromEntries(
            clients.map((client) => [client.id, client.displayName || "Guest"]),
          )}
          roomState={roomState ?? undefined}
          onVote={handleVote}
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
