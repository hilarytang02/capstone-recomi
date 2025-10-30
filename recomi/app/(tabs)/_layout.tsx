import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { AuthGate, AuthProvider } from '../../shared/context/auth';
import { SavedListsProvider } from '../../shared/context/savedLists';

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <SavedListsProvider>
        <AuthGate>
          <Tabs
            initialRouteName="map"
            screenOptions={{
              tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
              headerShown: false,
            }}>
          <Tabs.Screen
            name="map"
            options={{
              title: 'Explore',
              tabBarIcon: ({ color }) => <TabBarIcon name="map" color={color} />,
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: 'Profile',
              tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
            }}
          />
          </Tabs>
        </AuthGate>
      </SavedListsProvider>
    </AuthProvider>
  );
}
