"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import BracketGame from "@/app/components/bracket-game";
import { useUser } from "@/app/user-provider";

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
  votesByMatch?: Record<string, Record<string, { choice: number; at: number }>>;
  pendingVoteCount: number;
  winner?: { _id: string; title: string } | null;
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

  const resolveParticipantId = () => {
    if (participantId) {
      return participantId;
    }

    const key = "tvt-participant-id";
    const existing = window.localStorage.getItem(key);
    if (existing) {
      setParticipantId(existing);
      return existing;
    }

    const created = window.crypto.randomUUID();
    window.localStorage.setItem(key, created);
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
    const connectionStart = Date.now();
    let didOpen = false;
    const nextSocket = new WebSocket(
      `${wsProtocol}://${window.location.host}/ws?slug=${encodeURIComponent(slug)}&participantId=${encodeURIComponent(resolvedParticipantId)}&displayName=${encodeURIComponent(resolvedName)}`,
    );

    const timeoutHandle = window.setTimeout(() => {
      if (didOpen) {
        return;
      }

      setConnectionError(
        "Could not connect to real-time server. Start the app with npm run dev for multiplayer rooms.",
      );
      nextSocket.close();
    }, 1500);

    nextSocket.addEventListener("open", () => {
      didOpen = true;
      window.clearTimeout(timeoutHandle);
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

        if (payload?.type === "vote-update" || payload?.type === "game-sync") {
          setRoomStatus(payload.roomStatus ?? roomStatus);
          setRoomState(payload.gameState);
        }
      } catch (error) {
        console.error("Error reading room state", error);
      }
    });

    nextSocket.addEventListener("close", () => {
      window.clearTimeout(timeoutHandle);
      setConnected(false);
    });

    nextSocket.addEventListener("error", () => {
      setConnectionError(
        "Real-time connection failed. Ensure websocket runtime is active (npm run dev).",
      );
    });

    setSocket(nextSocket);

    return () => {
      window.clearTimeout(timeoutHandle);
      nextSocket.close();
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

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <Chip label={`Room ${slug}`} color="primary" />
        <Chip
          label={connected ? "Connected" : "Connecting..."}
          color={connected ? "success" : "default"}
        />
        {connectTimeMs !== null ? (
          <Chip
            label={`Connect ${connectTimeMs}ms`}
            color={connectTimeMs <= 100 ? "success" : "warning"}
          />
        ) : null}
        <Chip label={joinedLabel} />
      </Box>
      {connectionError ? (
        <Typography color="error">{connectionError}</Typography>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        Share this room code with another player to join the same bracket game.
      </Typography>
      {roomStatus === "waiting" ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle1">
            Waiting room: the game will start when the host begins it.
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
      ) : (
        <Typography variant="subtitle1">Game in progress.</Typography>
      )}
      <BracketGame
        bracket={
          session.bracket as { items?: Array<{ _id: string; title: string }> }
        }
        slug={slug}
        session={session}
        roomState={roomState ?? undefined}
        onVote={handleVote}
      />
    </Box>
  );
}
