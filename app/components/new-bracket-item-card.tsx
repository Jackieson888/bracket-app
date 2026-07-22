"use client";

import {
  styled,
  Stack,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  TextField,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { useState } from "react";

const HiddenInput = styled("input")({
  display: "none",
});

export default function NewBracketItemCard({ onAddItem }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file) => {
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
    setFile(null);
  };

  return (
    <Card>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            width: "24em",
          }}
        >
          <Stack direction="row" spacing={1}>
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />

            <IconButton component="label">
              <CloudUploadIcon />
              <HiddenInput
                type="file"
                onChange={(e) => setFile(e.target.files[0])}
              />
            </IconButton>
          </Stack>

          <Stack spacing={3}>
            <Button
              variant="contained"
              size="small"
              onClick={handleSubmit}
              disabled={uploading}
            >
              {uploading ? "Uploading..." : "Add Bracket Item"}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
