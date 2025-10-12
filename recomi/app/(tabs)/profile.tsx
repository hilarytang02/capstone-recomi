import React from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from '../../components/MapView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LIST_DEFINITIONS,
  useSavedLists,
  type SavedEntry,
  type SavedListDefinition,
} from '../../shared/context/savedLists';

type GroupedList = {
  definition: SavedListDefinition;
  wishlist: SavedEntry[];
  favourite: SavedEntry[];
};

const DEFAULT_REGION: Region = {
  latitude: 37.773972,
  longitude: -122.431297,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

const computeRegion = (pins: SavedEntry[]): Region => {
  if (!pins.length) {
    return DEFAULT_REGION;
  }

  const latitudes = pins.map((entry) => entry.pin.lat);
  const longitudes = pins.map((entry) => entry.pin.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  const latitudeDelta = Math.max((maxLat - minLat) * 1.4, 0.02);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.4, 0.02);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { entries } = useSavedLists();

  const grouped = React.useMemo<GroupedList[]>(() => {
    return LIST_DEFINITIONS.map((definition) => {
      const related = entries.filter((entry) => entry.listId === definition.id);
      return {
        definition,
        wishlist: related.filter((entry) => entry.bucket === 'wishlist'),
        favourite: related.filter((entry) => entry.bucket === 'favourite'),
      };
    });
  }, [entries]);

  const [selectedListId, setSelectedListId] = React.useState(
    LIST_DEFINITIONS[0]?.id ?? null,
  );

  React.useEffect(() => {
    if (!selectedListId && LIST_DEFINITIONS.length) {
      setSelectedListId(LIST_DEFINITIONS[0].id);
    }
  }, [selectedListId]);

  const selectedGroup = React.useMemo(
    () => grouped.find((group) => group.definition.id === selectedListId),
    [grouped, selectedListId],
  );

  const pinsForMap = React.useMemo<SavedEntry[]>(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.wishlist, ...selectedGroup.favourite];
  }, [selectedGroup]);

  const regionForMap = React.useMemo(() => computeRegion(pinsForMap), [pinsForMap]);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + 24 },
      ]}
    >
      <Text style={styles.title}>Your Lists</Text>
      <Text style={styles.subtitle}>
        Tap a collection to explore its wishlist and favourites.
      </Text>

      <FlatList<GroupedList>
        horizontal
        data={grouped}
        keyExtractor={(item) => item.definition.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.gallery}
        renderItem={({ item }: { item: GroupedList }) => {
          const total = item.wishlist.length + item.favourite.length;
          const isSelected = item.definition.id === selectedListId;
          return (
            <Pressable
              style={[styles.galleryCard, isSelected && styles.galleryCardSelected]}
              onPress={() => setSelectedListId(item.definition.id)}
            >
              <Text style={styles.galleryTitle}>{item.definition.name}</Text>
              <Text style={styles.galleryCount}>{total} saved places</Text>
            </Pressable>
          );
        }}
      />

      <View style={styles.detailSection}>
        <Text style={styles.sectionTitle}>{selectedGroup?.definition.name ?? 'List details'}</Text>
        <MapView
          key={selectedListId ?? 'none'}
          style={styles.detailMap}
          region={regionForMap}
          initialRegion={regionForMap}
        >
          {pinsForMap.map((entry) => (
            <Marker
              key={`${entry.listId}-${entry.bucket}-${entry.savedAt}`}
              coordinate={{ latitude: entry.pin.lat, longitude: entry.pin.lng }}
              title={entry.pin.label}
              pinColor={entry.bucket === 'wishlist' ? '#f59e0b' : '#22c55e'}
            />
          ))}
        </MapView>

        <View style={styles.bucketSection}>
          <Text style={styles.bucketTitle}>Wishlist</Text>
          {selectedGroup?.wishlist.length ? (
            selectedGroup.wishlist.map((entry: SavedEntry) => (
              <Text key={`${entry.savedAt}-wishlist`} style={styles.bucketItem}>
                • {entry.pin.label}
              </Text>
            ))
          ) : (
            <Text style={styles.emptyState}>No wishlist saves yet.</Text>
          )}
        </View>

        <View style={styles.bucketSection}>
          <Text style={styles.bucketTitle}>Favourite</Text>
          {selectedGroup?.favourite.length ? (
            selectedGroup.favourite.map((entry: SavedEntry) => (
              <Text key={`${entry.savedAt}-favourite`} style={styles.bucketItem}>
                • {entry.pin.label}
              </Text>
            ))
          ) : (
            <Text style={styles.emptyState}>No favourite saves yet.</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
    backgroundColor: '#f8fafc',
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
  },
  gallery: {
    gap: 12,
    paddingVertical: 8,
  },
  galleryCard: {
    width: 200,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
  },
  galleryCardSelected: {
    backgroundColor: '#c7d2fe',
  },
  galleryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  galleryCount: {
    marginTop: 4,
    fontSize: 12,
    color: '#475569',
  },
  detailSection: {
    backgroundColor: '#ffffff',
    padding: 18,
    borderRadius: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  detailMap: {
    height: 220,
    borderRadius: 16,
  },
  bucketSection: {
    gap: 8,
  },
  bucketTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  bucketItem: {
    fontSize: 14,
    color: '#475569',
  },
  emptyState: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
});
