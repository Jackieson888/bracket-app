"use client";

import { useState, type CSSProperties } from "react";

import {
  Card,
  CardActionArea,
  CardContent,
  Typography,
  Chip,
} from "@mui/material";
import MediaModal from "./media-modal";
import Image from "next/image";

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
  votes: number | null;
  className?: string;
  style?: CSSProperties;
};

export default function GameItemCard({
  item,
  index,
  handleVote,
  votes,
  className,
  style,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className={className} style={style}>
        <CardActionArea sx={{ padding: 1 }}>
          {item.url && (
            <Image
              src={item.url}
              alt={item.title}
              width={item.width}
              height={item.height}
              loading="eager"
              style={{
                width: "auto",
                height: 400,
                borderRadius: 8,
                paddingBottom: "8px",
              }}
              onClick={() => setOpen(true)}
            />
          )}
          <CardContent
            onClick={() => handleVote({ item, index })}
            sx={{
              padding: 0,
              display: "flex",
              flexDirection: "row",
            }}
          >
            <Typography
              variant="h5"
              color="primary"
              sx={{ fontWeight: "bold", flexGrow: 1 }}
            >
              {item.title}
            </Typography>
            {votes !== null && <Chip label={votes} />}
          </CardContent>
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
