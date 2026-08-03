"use client";

import { useState, useEffect } from "react";
import {
  Container,
  Box,
  Stack,
  Button,
  Typography,
  Divider,
} from "@mui/material";
import { useUser } from "../user-provider";
import BracketCard from "../components/bracket-card";

interface Item {
  _id: string;
  title: string;
  user: { name: string; picture: string };
  items: unknown[];
}

export default function Profile() {
  const userContext = useUser() as {
    user: { name?: string; picture?: string; email?: string } | null;
  } | null;
  const { user } = userContext || { user: null };
  const [joinError, setJoinError] = useState("");
  const [myBrackets, setMyBrackets] = useState<Item[]>([]);
  const [myBracketsLoading, setMyBracketsLoading] = useState(true);

  useEffect(() => {
    async function fetchBrackets() {
      try {
        const res = await fetch(
          `/api/brackets?'user.email'=${user?.email ?? ""}`,
          {
            method: "GET",
          },
        );
        const data = await res.json();
        setMyBrackets(data.brackets ?? []);
      } catch (err) {
        console.error("Error fetching brackets:", err);
      } finally {
        setMyBracketsLoading(false);
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
  return (
    <Container>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "8px",
        }}
      >
        {!user && (
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              size="large"
              href="/auth/login?screen_hint=signup"
            >
              Signup
            </Button>
            <Button variant="contained" size="large" href="/auth/login">
              Login
            </Button>
          </Stack>
        )}

        {user && (
          <Box
            sx={{
              my: 0.5,
              display: "flex",
              width: "stretch",
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
              <Typography variant="h6">My Brackets</Typography>
              <Divider
                sx={{ bgcolor: (theme) => theme.palette.secondary.main }}
              />
              {myBrackets.map((item: Item, idx: number) => (
                <BracketCard
                  key={item._id}
                  id={item._id}
                  index={idx}
                  item={item}
                  onPlayItem={handlePlayItem}
                />
              ))}
            </Stack>
            <Button variant="contained" size="large" href="/auth/logout">
              Logout
            </Button>
          </Box>
        )}
      </Box>
    </Container>
  );
}
