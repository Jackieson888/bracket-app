"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import BracketGame from "@/app/components/bracket-game";
import { useUser } from "@/app/user-provider";
import { Circle } from "@mui/icons-material";
import { Timer } from "@mui/icons-material";

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
  const reconnectAttemptRef = useRef(0);
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
          // Ignore storage failures; the in-memory state will still work for this tab.
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

    await fetch(`/api/sessions/${slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        participantId: resolvedParticipantId,
        displayName: resolvedName,
      }),
    });

    return resolvedParticipantId;
  };

  useEffect(() => {
    setSessionLoading(true);
    setSessionError("");

    fetch(`/api/sessions/${slug}`)
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
          const hydratedClients = Object.values(data.participantLookup).map(
            (entry) => ({
              id: entry.participantId,
              displayName: entry.displayName || "Guest",
              joinedAt: entry.joinedAt
                ? new Date(entry.joinedAt).getTime()
                : Date.now(),
            }),
          );
          if (hydratedClients.length > 0) {
            setClients(hydratedClients);
          }
        }
      })
      .catch((error) => {
        console.error(error);
        setSession(null);
        setSessionError(error?.message || "Unable to load room");
      })
      .finally(() => {
        setSessionLoading(false);
      });
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
      if (isUnmounted) {
        return;
      }

      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionError(
          "Real-time connection failed. Ensure websocket runtime is active (npm run dev), then refresh.",
        );
        return;
      }

      reconnectAttemptRef.current += 1;
      const attempt = reconnectAttemptRef.current;
      const retryDelayMs = Math.min(300 * attempt, 1000);
      setConnectionError(
        `Connecting to room... retry ${attempt}/${MAX_RECONNECT_ATTEMPTS}`,
      );
      reconnectTimeoutHandle = window.setTimeout(() => {
        connectSocket();
      }, retryDelayMs);
    };

    const connectSocket = () => {
      if (isUnmounted) {
        return;
      }

      setConnected(false);
      const connectionStart = Date.now();
      let wsUrl: URL;

      if (configuredWsBaseUrl) {
        const normalizedBase = configuredWsBaseUrl.replace(/\/+$/, "");
        const configuredUrl = new URL(normalizedBase);
        let configuredProtocol =
          configuredUrl.protocol === "https:"
            ? "wss:"
            : configuredUrl.protocol === "http:"
              ? "ws:"
              : configuredUrl.protocol;

        // Browsers block ws:// from secure origins, so upgrade protocol here.
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
      let didOpen = false;
      let didScheduleRetry = false;

      activeSocket = nextSocket;
      setSocket(nextSocket);

      openTimeoutHandle = window.setTimeout(() => {
        if (didOpen || isUnmounted) {
          return;
        }

        nextSocket.close();
      }, CONNECT_TIMEOUT_MS);

      nextSocket.addEventListener("open", () => {
        if (isUnmounted) {
          return;
        }

        didOpen = true;
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
        });

        setPendingVotes((current) => {
          if (current.length === 0) {
            return current;
          }

          const queued = [...current];
          const nextBatch = queued.splice(0);
          setTimeout(() => {
            nextBatch.forEach((vote) => {
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
          const payload = JSON.parse(event.data);
          if (payload?.type === "room-state") {
            setClients(payload.clients ?? []);
            setRoomStatus(payload.roomStatus ?? "waiting");
            if (payload.gameState) {
              setRoomState(payload.gameState);
            }
          }

          if (payload?.type === "game-started") {
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
            setRoomStatus("expired");
            setRoomState(null);
            setConnectionError(
              payload?.message || "This room has expired. Start a new one.",
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

        if (!didOpen && !didScheduleRetry) {
          didScheduleRetry = true;
          scheduleReconnect();
        }
      });

      nextSocket.addEventListener("error", () => {
        if (isUnmounted || didScheduleRetry) {
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
      clearHandles();
      activeSocket?.close();
      setSocket(null);
    };
  }, [slug]);

  const handleStartGame = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "start-game",
        slug,
        currentRoundItems:
          (
            session?.bracket as {
              items?: Array<{ _id: string; title: string }>;
            }
          )?.items ?? [],
      }),
    );
  };

  const handleJoinRoom = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const resolvedName = displayName.trim() || "Guest";
    const resolvedParticipantId = resolveParticipantId();
    setDisplayName(resolvedName);

    void persistJoin(resolvedName).catch((error) => {
      console.error("Failed to persist room join:", error);
    });

    socket.send(
      JSON.stringify({
        type: "join",
        slug,
        displayName: resolvedName,
        participantId: resolvedParticipantId,
      }),
    );
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
      return "Waiting for another player...";
    }

    if (clients.length === 1) {
      return "1 player in this room";
    }

    return `${clients.length} players in this room`;
  }, [clients.length]);

  const hasGameStarted =
    roomStatus === "started" ||
    roomStatus === "completed" ||
    Boolean(roomState?.currentRoundItems?.length);

  const roomExpired = roomStatus === "expired";

  if (sessionLoading) {
    return <div>Loading session...</div>;
  }

  if (sessionError) {
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography color="error">{sessionError}</Typography>
        <Button href="/play" variant="contained">
          Back to Play
        </Button>
      </Box>
    );
  }

  if (!session || !session.bracket) {
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography color="error">This room is unavailable.</Typography>
        <Button href="/play" variant="contained">
          Back to Play
        </Button>
      </Box>
    );
  }

  if (roomExpired) {
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography color="error">
          This bracket session expired after 30 minutes.
        </Typography>
        <Button href="/play" variant="contained">
          Back to Play
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2 }}>
      {!hasGameStarted ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle1">
            Waiting room: press Start Game when you are ready. You can also
            start and play solo.
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              alignItems: "center",
            }}
          >
            <TextField
              size="small"
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Guest"
            />
            <Button variant="contained" onClick={handleJoinRoom}>
              Set Name / Rejoin
            </Button>
            <Button variant="contained" onClick={handleStartGame}>
              Start Game
            </Button>
          </Box>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
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
          roomState={roomState ?? undefined}
          onVote={handleVote}
          playerCount={Math.max(1, clients.length)}
        />
      ) : null}
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: "space-between", width: "stretch" }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography component="span">Room &nbsp;</Typography>
          <Chip label={<code>{slug}</code>} color="secondary" />
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {connectTimeMs !== null ? (
            <Chip
              icon={
                connectTimeMs <= 100 ? (
                  <Circle sx={{ width: "24px", paddingLeft: "4px" }} />
                ) : (
                  <Timer sx={{ width: "24px", paddingLeft: "4px" }} />
                )
              }
              label={`${connectTimeMs}ms`}
              color={connectTimeMs <= 100 ? "primary" : "secondary"}
              variant="outlined"
            />
          ) : null}
          {connectionError ? (
            <Typography color="error" variant="body2">
              {connectionError}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </Box>
  );
}
