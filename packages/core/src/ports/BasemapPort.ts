/** BasemapPort — map tiles. Offline bundled tiles by default. */

export interface BasemapPort {
  /** MapLibre style URL or inline style object. */
  styleUrl(): string;
  /** True when this basemap needs the network — surfaced in the UI honestly. */
  requiresNetwork(): boolean;
  readonly attribution: string;
}
