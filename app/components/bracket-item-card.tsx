"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import MediaModal from "./media-modal";
import Image from "next/image";
import { IconButton } from "@mui/material";
import { Delete } from "@mui/icons-material";

export default function BracketItemCard({ item }) {
  const [open, setOpen] = useState(false);

  const handleDelete = (item) => {};

  return (
    <>
      <Card sx={{ display: "flex", cursor: "pointer" }}>
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <CardContent>
            <Typography variant="h5">{item.title}</Typography>
            <Typography variant="subtitle1" sx={{ color: "text.secondary" }}>
              {item.url ?? "No file uploaded"}
            </Typography>
          </CardContent>
        </Box>

        {item.url && (
          <Image
            src={item.url}
            alt={item.title}
            width={item.width}
            height={item.height}
            style={{ width: 200, height: "auto", borderRadius: 8 }}
          />
        )}

        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <IconButton aria-label="delete" onClick={handleDelete}>
            <Delete />
          </IconButton>
        </Box>
      </Card>

      <MediaModal open={open} onClose={() => setOpen(false)} item={item} />
    </>
  );
}
