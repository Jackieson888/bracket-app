"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Image from "next/image";
import { swatchForIndex } from "@/lib/avatar";

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
  isEditing,
  onDeleteItem,
  onToggleEdit,
  onTitleChange,
  isOverlay,
}: {
  item: item;
  index: number;
  id: string | number;
  isEditing: boolean;
  onDeleteItem: (index: number) => void;
  onToggleEdit: (index: number) => void;
  onTitleChange: (index: number, title: string) => void;
  isOverlay?: boolean;
}) {
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

  const swatch = swatchForIndex(index);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      className={isOverlay ? undefined : "bracket-pop-in-fade"}
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "stretch",
        backgroundColor: "var(--card-elevated)",
        borderRadius: "18px",
        border: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
        ...(isOverlay && { transform: "scale(1.05)", boxShadow: 6 }),
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          width: "30px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "grab",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "3px",
          }}
        >
          {Array.from({ length: 6 }).map((_, dotIndex) => (
            <Box
              key={dotIndex}
              sx={{
                width: "3px",
                height: "3px",
                borderRadius: "50%",
                backgroundColor: "var(--sub)",
              }}
            />
          ))}
        </Box>
      </Box>

      <Box
        sx={{
          width: "64px",
          height: "64px",
          margin: "12px 0 12px 2px",
          borderRadius: "12px",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
          border: `1px solid ${swatch}`,
          background:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 8px, rgba(255,255,255,0.015) 8px 16px)",
        }}
      >
        {item.url ? (
          <Image
            src={item.url}
            alt={item.title}
            fill
            sizes="64px"
            style={{ objectFit: "cover" }}
          />
        ) : (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(160deg, ${swatch}22, transparent 70%)`,
            }}
          />
        )}
      </Box>

      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          padding: "10px 12px",
          minWidth: 0,
        }}
      >
        {isEditing ? (
          <TextField
            value={item.title}
            onChange={(event) => onTitleChange(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onToggleEdit(index);
              }
            }}
            autoFocus
            variant="standard"
            fullWidth
            slotProps={{
              input: {
                disableUnderline: true,
                sx: {
                  fontFamily: "var(--font-heading)",
                  fontSize: "22px",
                  letterSpacing: "1px",
                  color: "text.primary",
                  textTransform: "uppercase",
                  borderBottom: "2px solid var(--teal)",
                },
              },
            }}
          />
        ) : (
          <Typography
            sx={{
              fontFamily: "var(--font-heading)",
              fontSize: "24px",
              letterSpacing: "1px",
              color: "text.primary",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.title}
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          width: "50px",
          flexShrink: 0,
          backgroundColor: "var(--peach)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        <Box
          role="button"
          aria-label="Edit title"
          onClick={() => onToggleEdit(index)}
          sx={{
            cursor: "pointer",
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M12 20h9" stroke="#241c34" strokeWidth="2.2" strokeLinecap="round" />
            <path
              d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"
              stroke="#241c34"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
          </svg>
        </Box>
        <Box
          role="button"
          aria-label="Delete item"
          onClick={() => onDeleteItem(index)}
          sx={{
            cursor: "pointer",
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.55,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"
              stroke="#241c34"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Box>
      </Box>
    </Box>
  );
}
