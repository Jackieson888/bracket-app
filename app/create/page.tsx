"use client";

import { Container, Box, Typography } from "@mui/material";
import { useUser } from "../user-provider";
import BracketItemCard from "../components/bracket-item-card";
import NewBracketItemCard from "../components/new-bracket-item-card";
import PillLabel from "../components/pill-label";
import { useState, useEffect } from "react";
import { focusableButtonSx, onActivateKeyDown } from "@/lib/a11y";
import { visuallyHidden } from "@mui/utils";

import {
  DndContext,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  DragEndEvent,
  UniqueIdentifier,
} from "@dnd-kit/core";

import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";

type BracketItem = {
  id: string;
  title: string;
  [key: string]: unknown;
};

const MIN_ITEMS = 4;

export default function CreateBracketPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const userContext = useUser();
  const { user } = userContext || { user: null };

  const [bracketItems, setBracketItems] = useState<BracketItem[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem("bracketItems");
    return stored ? JSON.parse(stored) : [];
  });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  const activeItem =
    activeId !== null
      ? bracketItems.find((item) => item.id === activeId)
      : null;
  const activeItemIndex =
    activeItem !== null
      ? bracketItems.findIndex((item) => item.id === activeId)
      : -1;

  const handleToggleEdit = (index: number) => {
    setEditingIndex((current) => (current === index ? null : index));
  };

  const handleTitleChange = (index: number, value: string) => {
    setBracketItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, title: value } : item)),
    );
  };

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem("bracketItems", JSON.stringify(bracketItems));
  }, [bracketItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Lets the focused drag handle be reordered with arrow keys, so
    // reordering isn't only possible via a pointer drag gesture.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleAddItem = (item: Omit<BracketItem, "id">) => {
    const newItem = { ...item, id: crypto.randomUUID() } as BracketItem;
    setBracketItems((prev) => [...prev, newItem]);
  };

  const handleDeleteItem = (index: number) => {
    setBracketItems((prev) => prev.filter((_, i) => i !== index));
    setEditingIndex((current) => (current === index ? null : current));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = bracketItems.findIndex((i) => i.id === active.id);
    const newIndex = bracketItems.findIndex((i) => i.id === over.id);

    setBracketItems((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const handleSaveBracket = async () => {
    if (!user) return alert("You must be logged in to save.");
    if (bracketItems.length < MIN_ITEMS)
      return alert("You need at least 4 items to save a bracket.");

    await fetch("/api/brackets", {
      method: "POST",
      body: JSON.stringify({ title, description, items: bracketItems, user }),
    });
  };

  const handlePlayBracket = () => {
    if (bracketItems.length < MIN_ITEMS)
      return alert("You need at least 4 items to play.");

    window.location.href = "/play";
  };

  const itemsNeeded = Math.max(0, MIN_ITEMS - bracketItems.length);
  const isReady = itemsNeeded === 0;

  return (
    <Container>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          padding: "22px 18px",
        }}
      >
        <Typography component="h1" sx={visuallyHidden}>
          Create a Bracket
        </Typography>
        <Box className="bracket-pop-in" sx={{ position: "relative", mt: 1 }}>
          <PillLabel>BRACKET NAME</PillLabel>
          <Box
            sx={{
              backgroundColor: "var(--card-elevated)",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: "20px 16px 14px",
            }}
          >
            <Box
              component="input"
              value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTitle(e.target.value)
              }
              placeholder="Untitled Bracket"
              aria-label="Bracket name"
              sx={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "2px solid transparent",
                outlineOffset: "2px",
                "&:focus-visible": {
                  outline: "2px solid var(--primary)",
                },
                borderBottom: "2px solid rgba(var(--primary-rgb),0.4)",
                paddingBottom: "8px",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                fontSize: "16px",
                color: "text.primary",
                textOverflow: "ellipsis",
              }}
            />
          </Box>
        </Box>

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
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                maxHeight: "65vh",
                overflowY: "auto",
              }}
            >
              {bracketItems.map((item, idx) => (
                <BracketItemCard
                  key={item.id}
                  id={item.id}
                  index={idx}
                  item={item}
                  isEditing={editingIndex === idx}
                  onDeleteItem={handleDeleteItem}
                  onToggleEdit={handleToggleEdit}
                  onTitleChange={handleTitleChange}
                />
              ))}
            </Box>
          </SortableContext>
          <DragOverlay>
            {activeId ? (
              <BracketItemCard
                id={activeId}
                index={activeItemIndex}
                item={bracketItems.find((i) => i.id === activeId)!}
                isEditing={false}
                onDeleteItem={() => {}}
                onToggleEdit={() => {}}
                onTitleChange={() => {}}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        <Box className="bracket-pop-in" sx={{ position: "relative", mt: 0.25 }}>
          <PillLabel>NEW ITEM</PillLabel>
          <NewBracketItemCard onAddItem={handleAddItem} />
        </Box>

        {isReady ? (
          <Box
            role="button"
            tabIndex={0}
            onClick={user ? handleSaveBracket : handlePlayBracket}
            onKeyDown={onActivateKeyDown(
              user ? handleSaveBracket : handlePlayBracket,
            )}
            className="bracket-glow-pulse"
            sx={{
              ...focusableButtonSx,
              cursor: "pointer",
              textAlign: "center",
              padding: "16px",
              borderRadius: "16px",
              backgroundColor: "var(--accent)",
            }}
          >
            <Typography
              sx={{
                fontFamily: "var(--font-display)",
                fontSize: "17px",
                letterSpacing: "1px",
                color: "var(--card)",
              }}
            >
              {user ? "SAVE BRACKET" : "PLAY BRACKET"}
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              textAlign: "center",
              padding: "16px",
              borderRadius: "16px",
              backgroundColor: "transparent",
              border: "1.5px dashed var(--sub)",
            }}
          >
            <Typography
              sx={{
                fontFamily: "var(--font-heading)",
                fontSize: "14px",
                letterSpacing: "2px",
                color: "text.secondary",
              }}
            >
              NEED {itemsNeeded} MORE ITEM{itemsNeeded === 1 ? "" : "S"}
            </Typography>
          </Box>
        )}
      </Box>
    </Container>
  );
}
