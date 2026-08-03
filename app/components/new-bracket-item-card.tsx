"use client";

import {
  styled,
  Box,
  Card,
  CardContent,
  IconButton,
  TextField,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import React, { useState } from "react";
import { Add } from "@mui/icons-material";
import Image from "next/image";

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);

    // Create preview URL
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);

    // Extract width/height
    const img = new window.Image();
    img.onload = () => {
      setPreviewSize({ width: img.width, height: img.height });
    };
    img.src = url;
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
    if (!title) return;

    let imageObj = null;

    if (file) {
      imageObj = await handleUpload(file);
    }

    const newItem = {
      title,
      ...imageObj,
    };

    onAddItem(newItem);

    setTitle("");
    setPreviewUrl(null);
    setFile(null);
  };

  return (
    <Card
      sx={{
        display: "flex",
        maxHeight: "100px",
        height: "100px",
        width: "100%",
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
        <CardContent sx={{ paddingY: 0 }}>
          <TextField
            hiddenLabel
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            variant="standard"
          />
        </CardContent>
      </Box>
      {previewUrl && (
        <Image
          src={previewUrl}
          alt={title}
          width={previewSize.width}
          height={previewSize.height}
          style={{ width: "auto", height: 100, borderRadius: 8 }}
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
        <IconButton aria-label="upload" color="secondary" component="label">
          <CloudUploadIcon />
          <HiddenInput type="file" onChange={handleFileSelect} />
        </IconButton>
        <IconButton
          aria-label="add"
          color="primary"
          onClick={handleSubmit}
          disabled={uploading}
        >
          <Add />
        </IconButton>
      </Box>
    </Card>
  );
}
