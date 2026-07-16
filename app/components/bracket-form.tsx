"use client";

import { useState } from "react";
import {
  Stack,
  Typography,
  Divider,
  Box,
  Button,
  Card,
  CardContent,
  TextField,
} from "@mui/material";
import { useUser } from "../user-provider";

export default function BracketForm() {
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const { user } = useUser();

  const handleSubmit = async () => {
    const payload = {
      title,
      subtitle,
      user,
    };

    try {
      setLoading(true);
      const res = await fetch("/api/bracket", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      console.log("Recommendations", data);
    } catch (err) {
      console.error("Error finding recommendations:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card sx={{ width: "100%" }}>
      <CardContent>
        <Typography gutterBottom variant="h5" component="div">
          Create Bracket
        </Typography>
        <Divider />
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
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />
          </Stack>
          <Stack spacing={3}>
            <TextField
              id="subtitle-input"
              label="Subtitle"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              fullWidth
            />
          </Stack>
          <Stack spacing={3}>
            <Divider
              sx={{ bgcolor: (theme) => theme.palette.secondary.main }}
            />

            <Button
              variant="contained"
              size="large"
              onClick={handleSubmit}
              loading={loading}
            >
              Create Bracket
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
