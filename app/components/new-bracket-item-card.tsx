"use client";

import { styled, Box, TextField, Typography } from "@mui/material";
import React, { useState } from "react";
import { focusableButtonSx, onActivateKeyDown } from "@/lib/a11y";

// display:none would remove this from the tab order entirely; clip it
// visually instead so the label + input stay reachable by keyboard.
const HiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

type BracketItem = {
  title: string;
  url?: string;
  width?: number;
  height?: number;
  mediaType?: "image" | "video";
  duration?: number | null;
};

export default function NewBracketItemCard({
  onAddItem,
}: {
  onAddItem: (item: BracketItem) => void;
}) {
  const [title, setTitle] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setUploadError(null);
  };

  const handleUpload = async (file: string | Blob) => {
    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    setUploading(false);

    if (!res.ok || !data.url) {
      setUploadError(data.error ?? "Upload failed. Try another file.");
      return null;
    }

    return {
      url: data.url,
      width: data.width,
      height: data.height,
      mediaType: data.mediaType ?? "image",
      duration: data.duration ?? null,
    };
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;

    let mediaObj = null;

    if (file) {
      mediaObj = await handleUpload(file);
      // A failed upload keeps the typed title and the picked file so the
      // player can retry instead of silently adding a media-less contender.
      if (!mediaObj) return;
    }

    const newItem = {
      title: title.trim().toUpperCase(),
      ...mediaObj,
    };

    onAddItem(newItem);

    setTitle("");
    setFile(null);
    setUploadError(null);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    <Box
      sx={{
        display: "flex",
        alignItems: "stretch",
        backgroundColor: "rgba(var(--tertiary-rgb),0.12)",
        border: "2px dashed var(--tertiary)",
        borderRadius: "18px",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          padding: "20px 14px 14px",
          minWidth: 0,
        }}
      >
        <TextField
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleSubmit();
            }
          }}
          placeholder="Name this contender..."
          aria-label="Contender name"
          variant="standard"
          fullWidth
          slotProps={{
            input: {
              disableUnderline: true,
              sx: {
                fontFamily: "var(--font-body)",
                fontSize: "16px",
                color: "text.primary",
                borderBottom: "1px solid rgba(var(--tertiary-rgb),0.4)",
                paddingBottom: "8px",
              },
            },
          }}
        />
      </Box>
      <Box
        sx={{
          width: "50px",
          flexShrink: 0,
          backgroundColor: "var(--primary)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
        }}
      >
        <Box
          component="label"
          aria-label="Upload media"
          sx={{
            cursor: "pointer",
            width: "40px",
            height: "40px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: file ? 1 : 0.65,
            outline: "2px solid transparent",
            outlineOffset: "2px",
            "&:has(:focus-visible)": {
              outline: "2px solid var(--primary)",
            },
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V4m0 0-4 4m4-4 4 4"
              stroke="var(--card)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              stroke="var(--card)"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <HiddenInput
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm"
            onChange={handleFileSelect}
          />
        </Box>
        <Box
          role="button"
          tabIndex={0}
          aria-label="Add item"
          onClick={() => {
            if (!uploading) {
              void handleSubmit();
            }
          }}
          onKeyDown={onActivateKeyDown(() => {
            if (!uploading) {
              void handleSubmit();
            }
          })}
          sx={{
            ...focusableButtonSx,
            cursor: uploading ? "default" : "pointer",
            opacity: uploading ? 0.5 : 1,
            width: "40px",
            height: "40px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 5v14M5 12h14"
              stroke="var(--card)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </Box>
      </Box>
    </Box>
      {file && !uploadError ? (
        <Typography
          sx={{
            px: "6px",
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "text.secondary",
          }}
        >
          {uploading ? "Uploading" : "Ready"}: {file.name}
        </Typography>
      ) : null}
      {uploadError ? (
        <Typography
          role="alert"
          sx={{
            px: "6px",
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "error.main",
          }}
        >
          {uploadError}
        </Typography>
      ) : null}
    </Box>
  );
}
