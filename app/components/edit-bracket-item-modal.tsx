"use client";

import { Modal, Box, TextField, Button } from "@mui/material";
import { useState, useEffect } from "react";
import Image from "next/image";

export default function EditBracketItemModal({ open, item, onClose, onSave }) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (item) setTitle(item.title);
  }, [item]);

  const handleSave = () => {
    onSave({ ...item, title });
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          bgcolor: "background.paper",
          p: 3,
          borderRadius: 2,
          width: 400,
        }}
      >
        <TextField
          fullWidth
          label="Edit Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {item.url && (
          <Image
            src={item.url}
            alt={item.title}
            width={item.width}
            height={item.height}
            style={{ width: "auto", height: "auto", borderRadius: 8 }}
          />
        )}
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleSave}>
          Save
        </Button>
      </Box>
    </Modal>
  );
}
