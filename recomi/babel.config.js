// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // The 'expo-router/babel' plugin is now deprecated and should be removed. 
      // It is included automatically in 'babel-preset-expo' for SDK 50+.

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