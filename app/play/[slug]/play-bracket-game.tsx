"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import BracketGame from "@/app/components/bracket-game";
import { useUser } from "@/app/user-provider";

type Session = {
  bracket: unknown;
  slug?: string;
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
  votes: Record<string, number>;
  pendingVoteCount: number;
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

  useEffect(() => {
    fetch(`/api/sessions/${slug}`)
      .then((res) => res.json())
      .then((data: Session) => {
        setSession(data);
      })
      .catch(console.error);
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

    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const nextSocket = new WebSocket(
      `${wsProtocol}://${window.location.host}/ws?slug=${slug}`,
    );

    nextSocket.addEventListener("open", () => {
      setConnected(true);
      nextSocket.send(
        JSON.stringify({
          type: "join",
          slug,
          displayName: displayName || "Guest",
        }),
      );

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
                playerId: nextSocket.url,
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
      setConnected(false);
    });

    setSocket(nextSocket);

    return () => {
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
    setDisplayName(resolvedName);
    socket.send(
      JSON.stringify({
        type: "join",
        slug,
        displayName: resolvedName,
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
        playerId: socket.url,
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

  if (!session || !session.bracket) {
    return <div>Loading session...</div>;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <Chip label={`Room ${slug}`} color="primary" />
        <Chip
          label={connected ? "Connected" : "Connecting..."}
          color={connected ? "success" : "default"}
        />
        <Chip label={joinedLabel} />
      </Box>
      <Typography variant="body2" color="text.secondary">
        Share this room code with another player to join the same bracket game.
      </Typography>
      {roomStatus === "waiting" ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle1">
            Waiting room: the game will start when the host begins it.
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems="center"
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
          </Stack>
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
