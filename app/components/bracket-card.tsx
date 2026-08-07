"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { initialsFor, swatchForIndex } from "@/lib/avatar";
import { focusableButtonSx, onActivateKeyDown } from "@/lib/a11y";

interface BracketItem {
  title: string;
  user: {
    name: string;
    picture: string;
  };
  items: unknown[];
  stats?: {
    playCount: number;
    topItemTitle: string | null;
  };
}

export default function BracketCard({
  item,
  index,
  onPlayItem,
}: {
  item: BracketItem;
  index: number;
  id: string | number;
  onPlayItem: (item: BracketItem) => void;
}) {
  const swatch = swatchForIndex(index);

  return (
    <Box
      className="bracket-pop-in-fade"
      sx={{
        display: "flex",
        alignItems: "stretch",
        backgroundColor: "var(--card-elevated)",
        borderRadius: "18px",
        border: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: "56px",
          height: "72px",
          margin: "12px 0 12px 12px",
          borderRadius: "10px",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
          border: `1px solid ${swatch}`,
          background:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 8px, rgba(255,255,255,0.015) 8px 16px)",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(160deg, ${swatch}22, transparent 70%)`,
          }}
        />
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "6px",
          padding: "10px 10px 10px 12px",
        }}
      >
        <Typography
          sx={{
            fontFamily: "var(--font-heading)",
            fontSize: "19px",
            letterSpacing: "0.5px",
            color: "var(--primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Box
            sx={{
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              backgroundColor: swatch,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-heading)",
              fontSize: "10px",
              color: "var(--card)",
              flexShrink: 0,
            }}
          >
            {initialsFor(item.user?.name ?? "Guest")}
          </Box>
          <Typography
            sx={{
              fontFamily: "var(--font-body)",
              fontWeight: 700,
              fontSize: "12px",
              color: "var(--primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.user?.name ?? "Guest"}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 10px",
          flexShrink: 0,
        }}
      >
        <Typography
          sx={{
            fontFamily: "var(--font-heading)",
            fontSize: "11px",
            letterSpacing: "1px",
            color: "text.secondary",
            whiteSpace: "nowrap",
          }}
        >
          {item.items?.length ?? 0} SEEDS
          {item.stats?.playCount ? (
            <Box
              component="span"
              sx={{ color: "var(--primary)" }}
            >
              {" "}
              · {item.stats.playCount}
              {item.stats.playCount === 1 ? " PLAY" : " PLAYS"}
            </Box>
          ) : null}
        </Typography>
      </Box>

      <Box
        role="button"
        tabIndex={0}
        aria-label={`Play ${item.title}`}
        onClick={() => onPlayItem(item)}
        onKeyDown={onActivateKeyDown(() => onPlayItem(item))}
        sx={{
          ...focusableButtonSx,
          cursor: "pointer",
          width: "50px",
          flexShrink: 0,
          backgroundColor: "var(--primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M6 4v16l14-8Z" fill="var(--secondary)" />
        </svg>
      </Box>
    </Box>
  );
}
