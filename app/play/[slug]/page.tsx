import PlayBracketGame from "./play-bracket-game";
import React from "react";

export default function PlayBracket({ params }) {
  const { slug } = React.use(params);
  return <PlayBracketGame slug={slug} />;
}
