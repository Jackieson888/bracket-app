"use client";

import { Container, Box, Stack, Button } from "@mui/material";
import { useUser } from "../user-provider";
import BracketForm from "../components/bracket-form";

export default function Home() {
  const { user, setGuestMode } = useUser();
  return (
    <Container>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <BracketForm />
      </Box>
    </Container>
  );
}
