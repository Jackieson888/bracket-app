"use client";

import { Modal, Box } from "@mui/material";
import Image from "next/image";

export default function MediaModal({ open, onClose, item }) {
  if (!item) return null;

  const isImage = item.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isVideo = item.url?.match(/\.(mp4|webm|ogg)$/i);
  const isAudio = item.url?.match(/\.(mp3|wav|aac)$/i);

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          bgcolor: "background.paper",
          boxShadow: 24,
          p: 2,
          maxWidth: "90vw",
          maxHeight: "90vh",
          width: "max-content",
          outline: "none",
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

        {isAudio && <audio src={item.url} controls style={{ width: "100%" }} />}
      </Box>
    </Modal>
  );
}
