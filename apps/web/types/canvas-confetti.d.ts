declare module "canvas-confetti" {
  const confetti: (options?: {
    particleCount?: number;
    spread?: number;
    origin?: { x?: number; y?: number };
    colors?: string[];
  }) => void;
  export default confetti;
}