"use client";

import { useState, useEffect } from "react";
import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useUser } from "../user-provider";
import BracketCard from "../components/bracket-card";

interface Item {
  _id: string;
  title: string;
  user: { name: string; picture: string };
  items: unknown[];
}

export default function Play() {
  const userContext = useUser();
  const { user } = userContext || { user: null };
  const [bracketsLoading, setBracketsLoading] = useState(true);
  const [joinLoading, setJoinLoading] = useState(false);
  const [slug, setSlug] = useState("");
  const [newestBrackets, setNewestBrackets] = useState<Item[]>([]);
  const [joinError, setJoinError] = useState("");

  void user;

  const normalizeRoomCode = (value: string) =>
    value.trim().replace(/\s+/g, "").toUpperCase();

  useEffect(() => {
    async function fetchBrackets() {
      try {
        const res = await fetch("/api/brackets", {
          method: "GET",
        });
        const data = await res.json();
        setNewestBrackets(data.brackets ?? []);
      } catch (err) {
        console.error("Error fetching brackets:", err);
      } finally {
        setBracketsLoading(false);
      }
    }

    fetchBrackets();
  }, []);

  const handlePlayItem = async (item: unknown) => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      if (!data?.slug) {
        throw new Error("Session could not be created");
      }
      window.location.href = `/play/${data.slug}`;
    } catch (err) {
      console.error("Error generating game session: ", err);
      setJoinError("Unable to create that room right now.");
    }
  };

  const handleSubmit = async () => {
    const trimmedSlug = normalizeRoomCode(slug);

    if (!trimmedSlug) {
      setJoinError("Please enter a room code.");
      return;
    }

    try {
      setJoinLoading(true);
      setJoinError("");
      setSlug(trimmedSlug);

      const response = await fetch(`/api/sessions/${trimmedSlug}`);
      if (!response.ok) {
        if (response.status === 404) {
          setJoinError("That room code is invalid or expired.");
          return;
        }

        setJoinError("Unable to verify that room right now.");
        return;
      }

      window.location.href = `/play/${trimmedSlug}`;
    } catch (err) {
      console.error("Error joining room:", err);
      setJoinError("Unable to enter that room.");
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <Container maxWidth="md">
      <Stack spacing={2.5} sx={{ py: { xs: 1.5, sm: 2 } }}>
        <Box
          sx={{
            borderRadius: 3,
            p: { xs: 1.75, sm: 2.25 },
            background:
              "linear-gradient(135deg, rgba(22,63,95,0.16) 0%, rgba(173,86,33,0.16) 100%)",
            border: "1px solid rgba(255,255,255,0.18)",
          }}
        >
          <Typography variant="h4">Play Live Brackets</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Join an existing room code or launch a live match from a bracket.
          </Typography>
        </Box>

        <Box
          component="form"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1.75,
            borderRadius: 3,
            p: { xs: 1.75, sm: 2.25 },
            border: "1px solid",
            borderColor: "divider",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <Typography variant="h6">Join By Room Code</Typography>
          <TextField
            id="title-input"
            label="Room Code"
            value={slug}
            slotProps={{ htmlInput: { maxLength: 12 } }}
            onChange={(e) => {
              setSlug(normalizeRoomCode(e.target.value));
              if (joinError) {
                setJoinError("");
              }
            }}
            helperText="Room codes are uppercase letters."
            fullWidth
          />

          {joinError ? <Alert severity="error">{joinError}</Alert> : null}

          <Button variant="contained" size="large" type="submit" disabled={joinLoading}>
            {joinLoading ? "Checking Room..." : "Enter Room"}
          </Button>
        </Box>

        <Divider sx={{ bgcolor: (theme) => theme.palette.secondary.main }} />

        <Stack spacing={1}>
          <Typography variant="h6">Start A New Live Room</Typography>
          <Typography variant="body2" color="text.secondary">
            Pick one of your recent brackets to generate a room instantly.
          </Typography>
        </Stack>

        {bracketsLoading ? (
          <Typography variant="body2" color="text.secondary">
            Loading active brackets...
          </Typography>
        ) : null}

        <Box
          sx={{
            my: 0.5,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Stack
            spacing={{ xs: 1, sm: 2 }}
            direction="column"
            useFlexGap
            sx={{ flexWrap: "wrap", width: "100%" }}
          >
            {newestBrackets.map((item: Item, idx: number) => (
              <BracketCard
                key={item._id}
                id={item._id}
                index={idx}
                item={item}
                onPlayItem={handlePlayItem}
              />
            ))}
          </Stack>
        </Box>
      </Stack>
    </Container>
  );
}

