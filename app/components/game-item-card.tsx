"use client";

import { useState, type CSSProperties } from "react";

import { Box, Card, CardActionArea, Typography } from "@mui/material";
import MediaModal from "./media-modal";
import Image from "next/image";
import { isVideoItem, previewImageUrl } from "@/lib/media";
import AvatarGlyph from "./avatar-glyph";

type Item = {
  id?: string;
  url?: string;
  title: string;
  width?: number;
  height?: number;
  mediaType?: "image" | "video";
  duration?: number | null;
};

export type Voter = {
  id: string;
  initials: string | null;
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
  const isVideo = isVideoItem(item);
  // Videos show their Cloudinary poster frame here; the clip itself plays in
  // the pre-vote intro and in the modal, so the board stays quiet.
  const previewUrl = previewImageUrl(item);

  return (
    <>
      <Card
        className={className}
        style={style}
        sx={{
          position: "relative",
          borderRadius: "20px",
          border: "2px solid",
          borderColor: accentColor ?? "rgba(255,255,255,0.08)",
          transition: "border-color 200ms ease-in, transform 200ms ease-in",
          transform: accentColor ? "scale(1.015)" : "scale(1)",
        }}
      >
        {/* Sibling of the action area, not a child: CardActionArea renders a
            <button>, so a nested interactive control would be invalid markup
            and unreachable by keyboard. */}
        {item.url ? (
          <Box
            component="button"
            type="button"
            className="bracket-media-button"
            aria-label={`${isVideo ? "Play clip" : "View image"} for ${item.title}`}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
            }}
          >
            {isVideo ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </Box>
        ) : null}
        <CardActionArea onClick={() => handleVote({ item, index })}>
          <Box className="bracket-item-media">
            {previewUrl ? (
              <Image
                src={previewUrl}
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
                    <AvatarGlyph initials={voter.initials} size={13} />
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
