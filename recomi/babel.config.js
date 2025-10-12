// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // keep this if you're using Expo Router (you are)
      'expo-router/babel',
      [
        'module-resolver',
        {
          root: ['.'],
          alias: {
            '@': './', // so "@/components/..." -> "<root>/components/..."
          },
          extensions: [
            '.ts', '.tsx', '.js', '.jsx', '.json',
            '.native.ts', '.native.tsx', '.web.ts', '.web.tsx'
          ],
        },
      ],
    ],
  };
};
