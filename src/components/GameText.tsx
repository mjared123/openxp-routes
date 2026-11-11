import { colourParts } from "../route";

/** Guide text with the game's colour codes shown as colours. */
export function GameText({ text }: { text: string }) {
  return (
    <>
      {colourParts(text).map((part, i) =>
        part.colour ? (
          <span key={i} className={`gt gt-${part.colour}`}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
