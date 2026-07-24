"use client";

import { useState, useEffect } from "react";
import BracketGame from "@/app/components/bracket-game";

export default function PlayBracketGame({ slug }) {
  const [session, setSession] = useState(null);
  const [bracket, setBracket] = useState(null);

  // 1. Fetch the session
  useEffect(() => {
    fetch(`/api/sessions/${slug}`)
      .then((res) => res.json())
      .then((data) => {
        setSession(data);
      })
      .catch(console.error);
  }, [slug]);

  // 2. Fetch the bracket once session is loaded
  useEffect(() => {
    if (!session?.bracketId) return;

    fetch(`/api/brackets/${session.bracketId}`)
      .then((res) => res.json())
      .then((data) => {
        setBracket(data);
      })
      .catch(console.error);
  }, [session]);

  if (!session || !bracket) {
    return <div>Loading game...</div>;
  }

  return <BracketGame bracket={bracket} slug={slug} session={session} />;
}
