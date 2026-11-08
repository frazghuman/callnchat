import * as Location from 'expo-location';

export type Position = { lat: number; lng: number; acc?: number };

export class LocationPermissionError extends Error {
  constructor() {
    super('Allow location access for CallNChat in iOS Settings to share where you are.');
    this.name = 'LocationPermissionError';
  }
}

async function ensurePermission() {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) throw new LocationPermissionError();
}

function toPosition(p: Location.LocationObject): Position {
  const acc = p.coords.accuracy;
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    ...(acc !== null && acc >= 0 ? { acc: Math.round(acc) } : {}),
  };
}

export async function currentPosition(): Promise<Position> {
  await ensurePermission();
  return toPosition(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
}

/**
 * Position updates while the app is open (foreground permission only, so live location pauses
 * when the app is in the background and resumes when it comes back).
 */
export async function watchPosition(
  onPosition: (p: Position) => void,
): Promise<{ remove(): void }> {
  await ensurePermission();
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 20 },
    (p) => onPosition(toPosition(p)),
  );
}

export function mapsUrl({ lat, lng }: Position, label = 'Shared location'): string {
  return `maps://?ll=${lat},${lng}&q=${encodeURIComponent(label)}`;
}
