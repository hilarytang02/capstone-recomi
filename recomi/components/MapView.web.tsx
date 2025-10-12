import * as React from 'react';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const PROVIDER_GOOGLE = 'google' as const;
export const Marker = (_: any) => null;

export default function MapView(props: any) {
  return (
    <div style={{ height: 400, display: 'grid', placeItems: 'center', border: '1px solid #ddd' }}>
      <p>Map placeholder (web)</p>
    </div>
  );
}
