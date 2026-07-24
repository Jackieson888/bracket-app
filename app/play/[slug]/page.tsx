import BracketGame from "@/app/components/bracket-game";

export default async function PlayBracket({ params }) {
  const { slug } = params;
  const session = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${slug}`,
    { cache: "no-store" },
  ).then((res) => res.json());

  const bracketId = session.bracketId;

  const bracket = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/brackets/${bracketId}`,
    { cache: "no-store" },
  ).then((res) => res.json());

  return <BracketGame bracket={bracket} slug={slug} />;
}
