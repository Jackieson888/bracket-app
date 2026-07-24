"use client";

import { useState, useEffect } from "react";
import { Container, Box, Stack, Button, Typography } from "@mui/material";
import { useUser } from "../user-provider";

export default function Play() {
  const { user, setGuestMode } = useUser();
  const [loading, setLoading] = useState(true);
  const [newestBrackets, setNewestBrackets] = useState([]);

  useEffect(() => {
    async function fetchGameModes() {
      try {
        const res = await fetch("/api/brackets", {
          method: "GET",
        });
        const data = await res.json();
        setNewestBrackets(data.results);
      } catch (err) {
        console.error("Error fetching brackets:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchGameModes();
  }, []);

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
          <Typography>{newestBrackets}</Typography>
        </Stack>
      </Box>
    </Container>
  );
}
