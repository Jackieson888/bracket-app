"use client";

import { useState, useEffect } from "react";
import { Container, Box, Stack, Button, Typography } from "@mui/material";
import { useUser } from "../user-provider";
import BracketCard from "../components/bracket-card";
import generateSlug from "@/lib/slug";

export default function Play() {
  const { user, setGuestMode } = useUser();
  const [loading, setLoading] = useState(true);
  const [newestBrackets, setNewestBrackets] = useState([]);

  useEffect(() => {
    async function fetchBrackets() {
      try {
        const res = await fetch("/api/brackets", {
          method: "GET",
        });
        const data = await res.json();
        setNewestBrackets(data.brackets);
      } catch (err) {
        console.error("Error fetching brackets:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchBrackets();
  }, []);

  const handlePlayItem = async (item) => {
    const payload = item;
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log("TEST: ", data);
      window.location.href = `/play/${data.slug}`;
    } catch (err) {
      console.error("Error generating game session: ", err);
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
          {newestBrackets &&
            newestBrackets.map((item, idx) => (
              <BracketCard
                id={item._id}
                index={idx}
                item={item}
                onPlayItem={handlePlayItem}
              ></BracketCard>
            ))}
        </Stack>
      </Box>
    </Container>
  );
}
