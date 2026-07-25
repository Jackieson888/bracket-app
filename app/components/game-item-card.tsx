"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  Card,
  Box,
  CardActionArea,
  CardContent,
  CardMedia,
  Typography,
  IconButton,
} from "@mui/material";
import MediaModal from "./media-modal";
import Image from "next/image";
import { CheckCircle } from "@mui/icons-material";

export default function GameItemCard({ item, index, handleVote }) {
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
      {/* <Card
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        sx={{
          display: "flex",
          maxHeight: "100px",
          height: "100px",
          width: "100%",
          ...(isOverlay && {
            transform: "scale(1.05)",
            boxShadow: 6,
          }),
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
          <CardContent>
            <Typography
              variant="h5"
              color="primary"
              sx={{ fontWeight: "bold" }}
            >
              {item.title}
            </Typography>
          </CardContent>
        </Box>

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
            onClick={() => onEditItem(index)}
          >
            <Edit />
          </IconButton>
          <IconButton
            aria-label="delete"
            color="secondary"
            onClick={() => onDeleteItem(index)}
            sx={{ opacity: 0.5 }}
          >
            <Delete />
          </IconButton>
        </Box>
      </Card> */}

      <MediaModal open={open} onClose={() => setOpen(false)} item={item} />
    </>
  );
}
