"use client";

import { Container, Box, Stack, Button } from "@mui/material";
import { useUser } from "./user-provider";

export default function Home() {
  const { user, setGuestMode } = useUser();
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
          <Button fullWidth variant="contained" size="large" href="/create">
            Create New Bracket
          </Button>
          {user && (
            <Button fullWidth variant="contained" size="large">
              My Brackets
            </Button>
          )}
          <Button fullWidth variant="contained" size="large">
            Find Bracket
          </Button>
        </Stack>
      </Box>
    </Container>
  );
}
