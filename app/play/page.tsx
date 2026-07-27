"use client";

import { useState, useEffect } from "react";
import {
  Container,
  Box,
  Stack,
  TextField,
  Divider,
  Button,
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
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [newestBrackets, setNewestBrackets] = useState<Item[]>([]);
  const [joinError, setJoinError] = useState("");

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
        setLoading(false);
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
    const trimmedSlug = slug.trim();

    if (!trimmedSlug) {
      setJoinError("Please enter a room code.");
      return;
    }

    try {
      setLoading(true);
      setJoinError("");
      window.location.href = `/play/${trimmedSlug}`;
    } catch (err) {
      console.error("Error joining room:", err);
      setJoinError("Unable to enter that room.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container>
      <Box
        sx={{
          my: 1,
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
          sx={{ flexWrap: "wrap" }}
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
      <Box
        component="form"
        autoComplete="off"
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <Stack spacing={3}>
          <TextField
            id="title-input"
            label="Room Code"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            fullWidth
          />
          {joinError ? (
            <Typography color="error">{joinError}</Typography>
          ) : null}
        </Stack>
        <Stack spacing={3}>
          <Divider sx={{ bgcolor: (theme) => theme.palette.secondary.main }} />

          <Button
            variant="contained"
            size="large"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Joining..." : "Enter Room"}
          </Button>
        </Stack>
      </Box>
    </Container>
  );
}
