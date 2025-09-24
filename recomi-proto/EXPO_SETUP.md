# Expo Setup Guide for Recomi

## Prerequisites

1. **Install Expo CLI globally:**
   ```bash
   npm install -g @expo/cli
   ```

2. **Install EAS CLI for builds:**
   ```bash
   npm install -g eas-cli
   ```

## Project Structure for Cross-Platform

```
recomi-proto/
├── shared/                 # Shared business logic
│   ├── types/             # TypeScript types
│   ├── utils/             # Utility functions
│   ├── stores/            # Zustand stores
│   └── constants/          # App constants
├── src/
│   ├── web/               # Next.js specific code
│   └── mobile/            # Expo/React Native specific code
└── mobile/                # Future Expo project
```

## Setting Up Expo Project

1. **Create Expo project in sibling directory:**
   ```bash
   cd /Users/hilarytang/capstone-recomi
   npx create-expo-app recomi-mobile --template
   ```

2. **Install shared dependencies:**
   ```bash
   cd recomi-mobile
   npm install zustand clsx
   npm install --save-dev @types/react @types/react-native
   ```

3. **Install NativeWind for Tailwind-like styling:**
   ```bash
   npm install nativewind
   npm install --save-dev tailwindcss
   ```

4. **Create symlink to shared folder:**
   ```bash
   ln -s ../recomi-proto/shared ./shared
   ```

## Key Differences for Mobile

### Styling
- Use NativeWind instead of Tailwind CSS
- Replace HTML elements with React Native components
- Use StyleSheet for complex styles

### Navigation
- Use Expo Router or React Navigation
- Replace Next.js routing with mobile navigation

### Platform-Specific Features
- Location services for restaurant discovery
- Camera for photo uploads
- Push notifications for recommendations
- Social sharing capabilities

## Development Workflow

1. **Web Development:** Continue using Next.js for rapid prototyping
2. **Mobile Development:** Use Expo for mobile-specific features
3. **Shared Logic:** Keep business logic in `/shared` folder
4. **Testing:** Test on both web and mobile simultaneously

## Recommended Next Steps

1. Set up the Expo project structure
2. Implement core Recomi features in shared stores
3. Create platform-specific UI components
4. Add location services and camera functionality
5. Implement social features (following, sharing)
6. Build recommendation algorithm
