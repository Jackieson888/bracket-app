"use client";

import { Container, Box, Stack } from "@mui/material";

export default function Home() {
  return (
    <Container maxWidth="md">
      <Box
        sx={{
          my: 2,
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
        ></Stack>
      </Box>
    </Container>
  );
}
