const app = require("./app.json");

const base = app.expo ?? app;
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

module.exports = {
  ...base,
  ios: {
    ...base.ios,
    config: {
      ...(base.ios?.config ?? {}),
      googleMapsApiKey,
    },
  },
  android: {
    ...base.android,
    config: {
      ...(base.android?.config ?? {}),
      googleMaps: {
        ...(base.android?.config?.googleMaps ?? {}),
        apiKey: googleMapsApiKey,
      },
    },
  },
};
