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
import { visuallyHidden } from "@mui/utils";
import { useUser } from "../user-provider";
import BracketCard from "../components/bracket-card";
import { createSessionAndNavigate } from "@/lib/create-session";
import type { BracketSummary } from "../types/bracket";

export default function Profile() {
  const userContext = useUser() as {
    user: { name?: string; picture?: string; email?: string } | null;
  } | null;
  const { user } = userContext || { user: null };
  const [joinError, setJoinError] = useState("");
  const [myBrackets, setMyBrackets] = useState<BracketSummary[]>([]);
  const [myBracketsLoading, setMyBracketsLoading] = useState(true);
  const [profileStats, setProfileStats] = useState<{
    gamesHosted: number;
    gamesPlayed: number;
    favoriteItem: { title: string; count: number } | null;
    pickAccuracy: number | null;
  } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    async function fetchProfileStats() {
      try {
        const res = await fetch("/api/profile/stats");
        if (!res.ok) {
          return;
        }
        setProfileStats(await res.json());
      } catch (err) {
        console.error("Error fetching profile stats:", err);
      }
    }

    fetchProfileStats();
  }, [user]);

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
      await createSessionAndNavigate(item);
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
        <Typography component="h1" sx={visuallyHidden}>
          Profile
        </Typography>
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
              {profileStats ? (
                <>
                  <Typography variant="h6" component="h2">
                    Your Stats
                  </Typography>
                  <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
                    <Typography sx={{ fontSize: "14px", color: "text.secondary" }}>
                      Hosted {profileStats.gamesHosted}
                    </Typography>
                    <Typography sx={{ fontSize: "14px", color: "text.secondary" }}>
                      Played {profileStats.gamesPlayed}
                    </Typography>
                    {profileStats.favoriteItem ? (
                      <Typography sx={{ fontSize: "14px", color: "text.secondary" }}>
                        Favorite: {profileStats.favoriteItem.title} (
                        {profileStats.favoriteItem.count}×)
                      </Typography>
                    ) : null}
                    {profileStats.pickAccuracy !== null ? (
                      <Typography sx={{ fontSize: "14px", color: "text.secondary" }}>
                        Pick accuracy: {Math.round(profileStats.pickAccuracy * 100)}%
                      </Typography>
                    ) : null}
                  </Stack>
                  <Divider
                    sx={{ bgcolor: (theme) => theme.palette.secondary.main }}
                  />
                </>
              ) : null}
              <Typography variant="h6" component="h2">
                My Brackets
              </Typography>
              <Divider
                sx={{ bgcolor: (theme) => theme.palette.secondary.main }}
              />
              {myBrackets.map((item: BracketSummary, idx: number) => (
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
