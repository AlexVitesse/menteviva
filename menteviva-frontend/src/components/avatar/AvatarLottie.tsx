import { Player, PlayerEvent } from "@lottiefiles/react-lottie-player";
import { useRef } from "react";

interface Props {
  src: string;
  autoplay?: boolean;
  loop?: boolean;
  className?: string;
  onComplete?: () => void;
}

export function AvatarLottie({
  src,
  autoplay = true,
  loop = true,
  className = "",
  onComplete,
}: Props) {
  const playerRef = useRef<Player>(null);

  const handleEvent = (event: PlayerEvent) => {
    if (event === "complete" && onComplete) {
      onComplete();
    }
  };

  return (
    <Player
      ref={playerRef}
      autoplay={autoplay}
      loop={loop}
      src={src}
      onEvent={handleEvent}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
