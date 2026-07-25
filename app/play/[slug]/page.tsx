import PlayBracketGame from "./play-bracket-game";
import React from "react";

interface PlayBracketProps {
  params: Promise<{ slug: string }>;
}

export default function PlayBracket({ params }: PlayBracketProps) {
  const { slug } = React.use(params);
  return <PlayBracketGame slug={slug} />;
}
