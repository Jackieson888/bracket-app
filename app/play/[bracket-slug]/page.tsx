"use client";

import { Container, Box, Stack, Button, Typography } from "@mui/material";
import { useUser } from "./user-provider";

export default function PlayBracket() {
  const { user, setGuestMode } = useUser();
  const { slug } = params;

  const bracket = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/brackets/${slug}`,
  ).then((res) => res.json());

  return <BracketGame bracket={bracket} />;
}
