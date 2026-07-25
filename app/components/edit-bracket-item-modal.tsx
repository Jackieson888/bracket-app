"use client";

import { Modal, Box, TextField, Button } from "@mui/material";
import { useState } from "react";
import Image from "next/image";

type Item = {
  title?: string;
  url?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
};

export default function EditBracketItemModal({
  open,
  item,
  onClose,
  onSave,
}: {
  open: boolean;
  item?: Item | null;
  onClose: () => void;
  onSave: (item: Item | null) => void;
}) {
  const [title, setTitle] = useState<string>(item?.title ?? "");

  const handleSave = () => {
    onSave({ ...(item ?? {}), title });
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
        {item?.url && (
          <Image
            src={item.url}
            alt={item?.title ?? ""}
            width={item?.width}
            height={item?.height}
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
