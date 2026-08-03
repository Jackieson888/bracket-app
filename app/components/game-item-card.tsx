"use client";

import { useState, type CSSProperties } from "react";

import { Box, Card, CardActionArea, Typography } from "@mui/material";
import MediaModal from "./media-modal";
import Image from "next/image";

type Item = {
  url?: string;
  title: string;
  width?: number;
  height?: number;
};

export type Voter = {
  id: string;
  initials: string;
  color: string;
};

type Props = {
  item: Item;
  index: number;
  handleVote: (args: { item: Item; index: number }) => void;
  voters?: Voter[];
  extraVoterCount?: number;
  votePct?: number | null;
  accentColor?: string | null;
  className?: string;
  style?: CSSProperties;
};

export default function GameItemCard({
  item,
  index,
  handleVote,
  voters = [],
  extraVoterCount = 0,
  votePct = null,
  accentColor = null,
  className,
  style,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        className={className}
        style={style}
        sx={{
          borderRadius: "20px",
          border: "2px solid",
          borderColor: accentColor ?? "rgba(255,255,255,0.08)",
          transition: "border-color 200ms ease-in, transform 200ms ease-in",
          transform: accentColor ? "scale(1.015)" : "scale(1)",
        }}
      >
        <CardActionArea onClick={() => handleVote({ item, index })}>
          <Box
            className="bracket-item-media"
            onClick={(event) => {
              if (item.url) {
                event.stopPropagation();
                setOpen(true);
              }
            }}
          >
            {item.url ? (
              <Image
                src={item.url}
                alt={item.title}
                fill
                sizes="(max-width: 640px) 100vw, 480px"
                style={{ objectFit: "cover" }}
              />
            ) : null}
            {votePct !== null ? (
              <Box
                className="bracket-item-fill"
                sx={{
                  height: `${votePct}%`,
                  backgroundColor: accentColor ?? "var(--sub)",
                }}
              />
            ) : null}
          </Box>
          <Box sx={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography
              sx={{
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: "19px",
                color: "text.primary",
              }}
            >
              {item.title}
            </Typography>
            {voters.length > 0 || extraVoterCount > 0 ? (
              <Box sx={{ display: "flex", alignItems: "center", minHeight: "24px" }}>
                {voters.map((voter) => (
                  <Box
                    key={voter.id}
                    className="bracket-voter-avatar"
                    sx={{ backgroundColor: voter.color }}
                  >
                    {voter.initials}
                  </Box>
                ))}
                {extraVoterCount > 0 ? (
                  <Typography
                    sx={{
                      marginLeft: "4px",
                      fontFamily: "var(--font-heading)",
                      fontSize: "12px",
                      color: "text.secondary",
                    }}
                  >
                    +{extraVoterCount}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
          </Box>
        </CardActionArea>
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
