"use client";

import { Modal, Box, Grow } from "@mui/material";
import Image from "next/image";

interface MediaModalProps {
  open: boolean;
  onClose: () => void;
  item: { url: string; title: string; width?: number; height?: number } | null;
}

export default function MediaModal({ open, onClose, item }: MediaModalProps) {
  if (!item) return null;

  const isImage = item.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isVideo = item.url?.match(/\.(mp4|webm|ogg)$/i);
  const isAudio = item.url?.match(/\.(mp3|wav|aac)$/i);

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeAfterTransition
      slotProps={{
        backdrop: {
          transitionDuration: 220,
        },
      }}
    >
      <Box
        onClick={onClose}
        sx={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 2,
        }}
      >
        <Grow
          in={open}
          timeout={260}
          style={{ transformOrigin: "center center" }}
        >
          <Box
            onClick={(event) => event.stopPropagation()}
            sx={{
              bgcolor: "background.paper",
              boxShadow: 24,
              p: 2,
              maxWidth: "90vw",
              maxHeight: "90vh",
              width: "max-content",
              outline: "none",
              borderRadius: 2,
            }}
          >
            {isImage && (
              <Image
                src={item.url}
                alt={item.title}
                width={item.width}
                height={item.height}
                style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }}
              />
            )}

            {isVideo && (
              <video
                src={item.url}
                controls
                style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 8 }}
              />
            )}

            {isAudio && (
              <audio src={item.url} controls style={{ width: "100%" }} />
            )}
          </Box>
        </Grow>
      </Box>
    </Modal>
  );
}
