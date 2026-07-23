"use client";

import {
  Container,
  Box,
  Stack,
  Button,
  TextField,
  Badge,
  Grid,
} from "@mui/material";
import { useUser } from "../user-provider";
import BracketItemCard from "../components/bracket-item-card";
import NewBracketItemCard from "../components/new-bracket-item-card";
import EditBracketItemModal from "../components/edit-bracket-item-modal";
import { useState, useEffect } from "react";

import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";

import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";

export default function CreateBracketPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { user } = useUser();

  const [bracketItems, setBracketItems] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const handleEditItem = (index) => {
    setEditingIndex(index);
  };

  const handleUpdateItem = (updatedItem) => {
    setBracketItems((prev) =>
      prev.map((item, i) => (i === editingIndex ? updatedItem : item)),
    );
    setEditingIndex(null);
  };

  // Load from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("bracketItems");
    if (stored) setBracketItems(JSON.parse(stored));
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem("bracketItems", JSON.stringify(bracketItems));
  }, [bracketItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleAddItem = (item) => {
    const newItem = { ...item, id: crypto.randomUUID() };
    setBracketItems((prev) => [...prev, newItem]);
  };

  const handleDeleteItem = (index) => {
    setBracketItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = bracketItems.findIndex((i) => i.id === active.id);
    const newIndex = bracketItems.findIndex((i) => i.id === over.id);

    setBracketItems((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const handleSaveBracket = async () => {
    if (!user) return alert("You must be logged in to save.");
    if (bracketItems.length < 4)
      return alert("You need at least 4 items to save a bracket.");

    await fetch("/api/brackets", {
      method: "POST",
      body: JSON.stringify({ title, description, items: bracketItems, user }),
    });
  };

  const handlePlayBracket = () => {
    if (bracketItems.length < 4)
      return alert("You need at least 4 items to play.");

    window.location.href = "/play";
  };

  return (
    <Container>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          backgroundColor: "#162727",
        }}
      >
        <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
          <TextField
            label="Bracket Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
          />
        </Stack>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(event) => setActiveId(event.active.id)}
          onDragEnd={(event) => {
            handleDragEnd(event);
            setActiveId(null);
          }}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext
            items={bracketItems.map((item) => item.id)}
            strategy={rectSortingStrategy}
          >
            <Grid
              container
              rowSpacing={{ xs: 1, sm: 2, md: 3 }}
              columnSpacing={{ xs: 1, sm: 2, md: 3 }}
            >
              {bracketItems.map((item, idx) => (
                <Grid item xs={6} key={item.id}>
                  <Badge
                    badgeContent={idx + 1}
                    anchorOrigin={{
                      vertical: "top",
                      horizontal: "left",
                    }}
                    color="primary"
                    sx={{
                      width: "100%",
                    }}
                  >
                    <BracketItemCard
                      id={item.id}
                      index={idx}
                      item={item}
                      onDeleteItem={handleDeleteItem}
                      onEditItem={handleEditItem}
                    />
                  </Badge>
                </Grid>
              ))}
            </Grid>
          </SortableContext>
          <DragOverlay>
            {activeId ? (
              <BracketItemCard
                item={bracketItems.find((i) => i.id === activeId)}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        <NewBracketItemCard onAddItem={handleAddItem} />

        <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
          <Button
            variant="contained"
            disabled={bracketItems.length < 4 || !user}
            onClick={handleSaveBracket}
          >
            Save Bracket
          </Button>

          <Button
            variant="contained"
            disabled={bracketItems.length < 4}
            onClick={handlePlayBracket}
          >
            Play Bracket
          </Button>
        </Stack>

        {editingIndex !== null && (
          <EditBracketItemModal
            open={editingIndex !== null}
            item={bracketItems[editingIndex]}
            onClose={() => setEditingIndex(null)}
            onSave={handleUpdateItem}
          />
        )}
      </Box>
    </Container>
  );
}
