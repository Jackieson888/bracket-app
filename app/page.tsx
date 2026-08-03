"use client";

import { Container, Box, Stack, Button } from "@mui/material";

export default function Home() {
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
          <Button fullWidth variant="contained" size="large" href="/play">
            Play A Bracket
          </Button>
        </Stack>
      </Box>
    </Container>
  );
}
