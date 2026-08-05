"use client";

import { styled, Box, TextField } from "@mui/material";
import React, { useState } from "react";

const HiddenInput = styled("input")({
  display: "none",
});

type BracketItem = {
  title: string;
  url?: string;
  width?: number;
  height?: number;
};

export default function NewBracketItemCard({
  onAddItem,
}: {
  onAddItem: (item: BracketItem) => void;
}) {
  const [title, setTitle] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
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

    const newItem = {
      title,
      url: data.url,
      width: data.width,
      height: data.height,
    };

    setUploading(false);

    return newItem;
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;

    let imageObj = null;

    if (file) {
      imageObj = await handleUpload(file);
    }

    const newItem = {
      title: title.trim().toUpperCase(),
      ...imageObj,
    };

    onAddItem(newItem);

    setTitle("");
    setFile(null);
  };

  return (
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
          backgroundColor: "var(--accent)",
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
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: file ? 1 : 0.65,
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
          <HiddenInput type="file" accept="image/*" onChange={handleFileSelect} />
        </Box>
        <Box
          role="button"
          aria-label="Add item"
          onClick={() => {
            if (!uploading) {
              void handleSubmit();
            }
          }}
          sx={{
            cursor: uploading ? "default" : "pointer",
            opacity: uploading ? 0.5 : 1,
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="var(--card)" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </Box>
      </Box>
    </Box>
  );
}
