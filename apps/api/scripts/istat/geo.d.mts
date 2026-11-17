export function utmToLatLon(easting: number, northing: number, zone: number): { lat: number; lon: number };
export function latLonToUtm(lat: number, lon: number, zone: number): { easting: number; northing: number };
export function pointOnSurface(rings: number[][][]): { x: number; y: number } | null;
export function isInside(rings: number[][][], x: number, y: number): boolean;
