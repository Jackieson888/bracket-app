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
        console.log("SESSION LOADED:", data);
        setSession(data);
      })
      .catch(console.error);
  }, [slug]);

  if (!session || !session.bracket) {
    return <div>Loading session...</div>;
  }

  return (
    <BracketGame bracket={session.bracket} slug={slug} session={session} />
  );
}
