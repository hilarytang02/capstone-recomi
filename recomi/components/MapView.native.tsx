import React from 'react';
import MapViewRN, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { MapViewProps, Region } from 'react-native-maps';

const MapView = React.forwardRef<MapViewRN, MapViewProps>((props, ref) => {
  const { provider, ...rest } = props;
  return <MapViewRN ref={ref} provider={provider ?? PROVIDER_GOOGLE} {...rest} />;
});

MapView.displayName = 'MapView';

export { Marker, PROVIDER_GOOGLE };
export type { Region };

// Re-export the default so consumers can `import MapView from '../../components/MapView';`
export default MapView;
