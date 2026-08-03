"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import BracketGame from "@/app/components/bracket-game";
import { useUser } from "@/app/user-provider";
import { CheckCircle, Circle, ContentCopy, Timer } from "@mui/icons-material";

type Session = {
  bracket: unknown;
  slug?: string;
  roomStatus?: string;
  gameState?: RoomState;
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

  const handleStartGame = () => {
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
    if (clients.length === 0) {
      return "Waiting for another player to join";
    }

    if (clients.length === 1) {
      return "1 player connected";
    }

    return `${clients.length} players connected`;
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
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: { xs: 1.75, sm: 2.25 },
            borderRadius: 3,
            p: { xs: 1.75, sm: 2.25 },
            border: "1px solid",
            borderColor: "divider",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <Typography variant="subtitle1">
            Waiting room is live. Set your name, confirm the roster, then start.
          </Typography>

          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: "wrap", rowGap: 1 }}
          >
            <Chip label={joinedLabel} color="primary" variant="outlined" />
            {pendingVotes.length > 0 ? (
              <Chip
                label={`${pendingVotes.length} queued vote${pendingVotes.length > 1 ? "s" : ""}`}
                color="warning"
                variant="outlined"
              />
            ) : null}
          </Stack>

          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1.25,
              alignItems: "center",
            }}
          >
            <TextField
              size="small"
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Guest"
              helperText="This is what other players will see."
              sx={{ minWidth: { xs: "100%", sm: 280 } }}
            />
            <Button
              variant="contained"
              onClick={handleJoinRoom}
              disabled={!canUseSocket || joinLoading || startLoading}
            >
              {joinLoading ? "Saving Name..." : "Update Name"}
            </Button>
            <Button
              variant="contained"
              onClick={handleStartGame}
              disabled={!canUseSocket || startLoading || joinLoading}
            >
              {startLoading ? "Starting..." : "Start Game"}
            </Button>
          </Box>

          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, mt: 0.75 }}>
            {clients.map((client) => (
              <Chip key={client.id} label={client.displayName || "Guest"} />
            ))}
          </Box>
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
