"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import MediaModal from "./media-modal";
import Image from "next/image";
import { IconButton } from "@mui/material";
import { Delete, Edit } from "@mui/icons-material";

interface item {
  title: string;
  url?: string;
  width?: number;
  height?: number;
}

export default function BracketItemCard({
  item,
  index,
  id,
  onDeleteItem,
  onEditItem,
  isOverlay,
}: {
  item: item;
  index: number;
  id: string | number;
  onDeleteItem: (index: number) => void;
  onEditItem: (index: number) => void;
  isOverlay?: boolean;
}) {
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
    animateLayoutChanges: ({ isSorting, wasDragging }) =>
      isSorting || wasDragging,
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
            backgroundColor: "#F0C69F",
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
      </Card>

      {item.url && (
        <MediaModal
          open={open}
          onClose={() => setOpen(false)}
          item={item as { url: string; title: string; width?: number; height?: number }}
        />
      )}
    </>
  );
}
