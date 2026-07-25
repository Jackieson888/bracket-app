"use client";

import { useState, useEffect } from "react";
import BracketGame from "@/app/components/bracket-game";

type Session = {
  bracket: unknown;
  [key: string]: unknown;
};

export default function PlayBracketGame({ slug }: { slug: string }) {
  const [session, setSession] = useState<Session | null>(null);

  // 1. Fetch the session
  useEffect(() => {
    fetch(`/api/sessions/${slug}`)
      .then((res) => res.json())
      .then((data: Session) => {
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
