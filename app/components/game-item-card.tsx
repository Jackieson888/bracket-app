"use client";

import { useState } from "react";

import {
  Card,
  Box,
  CardActionArea,
  CardContent,
  Typography,
  IconButton,
} from "@mui/material";
import MediaModal from "./media-modal";
import Image from "next/image";
import { CheckCircle } from "@mui/icons-material";

type Item = {
  url?: string;
  title: string;
  width?: number;
  height?: number;
};

type Props = {
  item: Item;
  index: number;
  handleVote: (args: { item: Item; index: number }) => void;
};

export default function GameItemCard({ item, index, handleVote }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card sx={{ maxWidth: 345 }}>
        <CardActionArea onClick={() => setOpen(true)}>
          {item.url && (
            <Image
              src={item.url}
              alt={item.title}
              width={item.width}
              height={item.height}
              style={{ width: "auto", height: 100, borderRadius: 8 }}
              onClick={() => setOpen(true)}
            />
          )}
          <CardContent>
            <Typography
              variant="h5"
              color="primary"
              sx={{ fontWeight: "bold" }}
            >
              {item.title}
            </Typography>
          </CardContent>
        </CardActionArea>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            backgroundColor: "#E79F7F",
          }}
        >
          <IconButton
            aria-label="edit"
            color="secondary"
            onClick={() => handleVote({ item, index })}
          >
            <CheckCircle />
          </IconButton>
        </Box>
      </Card>

      {item.url && (
        <MediaModal
          open={open}
          onClose={() => setOpen(false)}
          item={{ ...item, url: item.url }}
        />
      )}
    </>
  );
}
