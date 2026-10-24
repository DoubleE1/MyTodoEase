/** One cut sprite of a World theme, as written by frontend/scripts/world-sprites.py. */
export interface Sprite {
  url: string;
  width: number;
  height: number;
  /** Centre of the block's top face, in sprite pixels. */
  anchorX: number;
  anchorY: number;
}
