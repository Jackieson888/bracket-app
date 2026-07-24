"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { Avatar } from "@mui/material";
import { IconButton, Stack } from "@mui/material";
import { PlayArrow } from "@mui/icons-material";

export default function BracketCard({ item, index, id, onPlayItem }) {
  const [open, setOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    animateLayoutChanges: ({ isSorting, wasSorting }) =>
      isSorting || wasSorting,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <>
      <Card
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        sx={{
          display: "flex",
          maxHeight: "100px",
          height: "60px",
          width: "100%",
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "stretch",
          }}
        >
          <CardContent sx={{ width: "stretch" }}>
            <Typography
              variant="h5"
              color="primary"
              sx={{ fontWeight: "bold" }}
            >
              {item.title}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Avatar
                sx={{ width: 24, height: 24 }}
                alt={item.user.name}
                src={item.user.picture}
              />
              <Typography
                variant="subtitle1"
                color="primary"
                sx={{ fontWeight: "bold" }}
              >
                {item.user.name}
              </Typography>
            </Stack>
          </CardContent>
        </Box>
        <Stack sx={{ width: "auto", paddingRight: "8px" }}>
          <Typography
            variant="subtitle2"
            color="primary"
            sx={{ fontWeight: "bold" }}
          >
            Seeds
          </Typography>
          <Typography variant="h5" color="primary" sx={{ fontWeight: "bold" }}>
            {item.items.length}
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            backgroundColor: "#E79F7F",
          }}
        >
          <IconButton
            aria-label="play"
            color="secondary"
            onClick={() => onPlayItem(item)}
          >
            <PlayArrow />
          </IconButton>
        </Box>
      </Card>
    </>
  );
}
