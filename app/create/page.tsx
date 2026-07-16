"use client";

import { Container, Box, Stack } from "@mui/material";
import { useUser } from "../user-provider";
import BracketItemCard from "../components/bracket-item-card";
import NewBracketItemCard from "../components/new-bracket-item-card";
import { useState, useEffect } from "react";

export default function CreateBracketPage() {
  const { user } = useUser();

  const [bracketItems, setBracketItems] = useState([]);

  // Load from localStorage on first render
  useEffect(() => {
    const stored = localStorage.getItem("bracketItems");
    if (stored) {
      setBracketItems(JSON.parse(stored));
    }
  }, []);

  // Save to localStorage whenever bracketItems changes
  useEffect(() => {
    localStorage.setItem("bracketItems", JSON.stringify(bracketItems));
  }, [bracketItems]);

  const handleAddItem = (item) => {
    setBracketItems((prev) => [...prev, item]);
  };

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
        {bracketItems.length > 0 && (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {bracketItems.map((item, idx) => (
              <BracketItemCard key={idx} item={item} />
            ))}
          </Stack>
        )}

        <Stack spacing={1}>
          <NewBracketItemCard onAddItem={handleAddItem} />
        </Stack>
      </Box>
    </Container>
  );
}
