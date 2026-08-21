"use client";

import { useState, useEffect } from "react";
import { Container, Box, Typography } from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import BracketCard from "../components/bracket-card";
import PillLabel from "../components/pill-label";
import { focusableButtonSx, onActivateKeyDown } from "@/lib/a11y";
import type { BracketItem } from "../types/bracket";

interface Item {
  _id: string;
  title: string;
  user: { name: string; picture: string };
  items: BracketItem[];
}

export default function Play() {
  const [bracketsLoading, setBracketsLoading] = useState(true);
  const [joinLoading, setJoinLoading] = useState(false);
  const [slug, setSlug] = useState("");
  const [newestBrackets, setNewestBrackets] = useState<Item[]>([]);
  const [joinError, setJoinError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

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

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchError("Please enter a search query.");
      return;
    }

    try {
      setSearchLoading(true);
      setSearchError("");

      const response = await fetch(
        `/api/brackets?search=${encodeURIComponent(searchQuery)}`,
      );
      if (!response.ok) {
        setSearchError("Unable to search brackets right now.");
        return;
      }

      const data = await response.json();
      setNewestBrackets(data.brackets ?? []);
    } catch (err) {
      console.error("Error searching brackets:", err);
      setSearchError("Unable to search brackets.");
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <Container>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          padding: "22px 18px",
        }}
      >
        <Typography component="h1" sx={visuallyHidden}>
          Play
        </Typography>
        <Box
          component="form"
          className="bracket-pop-in"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          sx={{ position: "relative" }}
        >
          <PillLabel>JOIN BY ROOM CODE</PillLabel>
          <Box
            sx={{
              backgroundColor: "var(--card-elevated)",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "20px 16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <Box
              component="input"
              value={slug}
              maxLength={12}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setSlug(normalizeRoomCode(e.target.value));
                if (joinError) {
                  setJoinError("");
                }
              }}
              placeholder="Room Code"
              aria-label="Room code"
              sx={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "2px solid transparent",
                outlineOffset: "2px",
                "&:focus-visible": {
                  outline: "2px solid var(--primary)",
                },
                borderBottom: "2px solid rgba(var(--primary-rgb),0.4)",
                paddingBottom: "8px",
                fontFamily: "var(--font-heading)",
                letterSpacing: "2px",
                fontSize: "18px",
                color: "text.primary",
                textTransform: "uppercase",
              }}
            />
            {joinError ? (
              <Typography
                sx={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--primary)" }}
              >
                {joinError}
              </Typography>
            ) : null}
            <Box
              role="button"
              tabIndex={0}
              onClick={() => void handleSubmit()}
              onKeyDown={onActivateKeyDown(() => void handleSubmit())}
              sx={{
                ...focusableButtonSx,
                cursor: joinLoading ? "default" : "pointer",
                opacity: joinLoading ? 0.6 : 1,
                marginTop: "6px",
                textAlign: "center",
                padding: "14px",
                borderRadius: "14px",
                backgroundColor: "var(--primary)",
              }}
            >
              <Typography
                sx={{
                  fontFamily: "var(--font-display)",
                  fontSize: "15px",
                  letterSpacing: "1px",
                  color: "var(--card)",
                }}
              >
                {joinLoading ? "CHECKING ROOM..." : "ENTER ROOM"}
              </Typography>
            </Box>
          </Box>
        </Box>

        {bracketsLoading ? (
          <Typography
            sx={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "text.secondary", textAlign: "center" }}
          >
            Loading active brackets...
          </Typography>
        ) : null}

        <Box sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {newestBrackets.map((item: Item, idx: number) => (
            <BracketCard
              key={item._id}
              id={item._id}
              index={idx}
              item={item}
              onPlayItem={handlePlayItem}
            />
          ))}
        </Box>

        <Box
          component="form"
          className="bracket-pop-in"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSearch();
          }}
          sx={{ position: "relative", mt: 0.25 }}
        >
          <PillLabel>FIND A BRACKET</PillLabel>
          <Box
            sx={{
              backgroundColor: "var(--card-elevated)",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "20px 16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <Box
              component="input"
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSearchQuery(e.target.value)
              }
              placeholder="Search Brackets"
              aria-label="Search brackets"
              sx={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "2px solid transparent",
                outlineOffset: "2px",
                "&:focus-visible": {
                  outline: "2px solid var(--primary)",
                },
                borderBottom: "2px solid rgba(var(--tertiary-rgb),0.4)",
                paddingBottom: "8px",
                fontFamily: "var(--font-body)",
                fontSize: "16px",
                color: "text.primary",
              }}
            />
            {searchError ? (
              <Typography
                sx={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--primary)" }}
              >
                {searchError}
              </Typography>
            ) : null}
            <Box
              role="button"
              tabIndex={0}
              onClick={() => void handleSearch()}
              onKeyDown={onActivateKeyDown(() => void handleSearch())}
              sx={{
                ...focusableButtonSx,
                cursor: searchLoading ? "default" : "pointer",
                opacity: searchLoading ? 0.6 : 1,
                marginTop: "6px",
                textAlign: "center",
                padding: "14px",
                borderRadius: "14px",
                backgroundColor: "var(--primary)",
              }}
            >
              <Typography
                sx={{
                  fontFamily: "var(--font-display)",
                  fontSize: "15px",
                  letterSpacing: "1px",
                  color: "var(--card)",
                }}
              >
                {searchLoading ? "SEARCHING..." : "SEARCH"}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Container>
  );
}
