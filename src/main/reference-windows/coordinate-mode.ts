/** Minimal coordinate types retained from the reference backend. */

export type CoordinateMode = "millifraction" | "pixel";

export interface ObservationRaster {
  readonly width: number;
  readonly height: number;
}
