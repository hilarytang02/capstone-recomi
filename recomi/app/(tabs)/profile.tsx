import React from "react";
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, type Region } from "../../components/MapView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  useSavedLists,
  type SavedEntry,
  type SavedListDefinition,
} from "../../shared/context/savedLists";
import FontAwesome from "@expo/vector-icons/FontAwesome";

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
  const { entries, lists, removeList, addList } = useSavedLists();
  const [deleteMode, setDeleteMode] = React.useState(false);
  const wiggleAnim = React.useRef(new Animated.Value(0)).current;
  const wiggleLoop = React.useRef<Animated.CompositeAnimation | null>(null);
  const galleryRef = React.useRef<FlatList<GroupedList> | null>(null);
  const [newListModalVisible, setNewListModalVisible] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  const [newListError, setNewListError] = React.useState<string | null>(null);

  const grouped = React.useMemo<GroupedList[]>(() => {
    return lists.map((definition) => {
      const related = entries.filter((entry) => entry.listId === definition.id);
      return {
        definition,
        wishlist: related.filter((entry) => entry.bucket === 'wishlist'),
        favourite: related.filter((entry) => entry.bucket === 'favourite'),
      };
    });
  }, [entries, lists]);

  const [selectedListId, setSelectedListId] = React.useState(
    lists[0]?.id ?? null,
  );

  React.useEffect(() => {
    if (!lists.length) {
      setSelectedListId(null);
      setDeleteMode(false);
      return;
    }

    if (!selectedListId || !lists.some((list) => list.id === selectedListId)) {
      setSelectedListId(lists[0].id);
    }
  }, [lists, selectedListId]);

  React.useEffect(() => {
    if (!deleteMode) return;

    wiggleLoop.current?.stop();
    wiggleLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggleAnim, {
          toValue: 1,
          duration: 140,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(wiggleAnim, {
          toValue: -1,
          duration: 140,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    wiggleLoop.current.start();

    return () => {
      wiggleLoop.current?.stop();
    };
  }, [deleteMode, wiggleAnim]);

  React.useEffect(() => {
    if (deleteMode) {
      return;
    }

    wiggleLoop.current?.stop();
    wiggleAnim.setValue(0);
  }, [deleteMode, wiggleAnim]);

  useFocusEffect(
    React.useCallback(() => {
      return () => {
        wiggleLoop.current?.stop();
        wiggleAnim.setValue(0);
        setDeleteMode(false);
        setNewListModalVisible(false);
        setNewListName("");
        setNewListError(null);
      };
    }, [wiggleAnim]),
  );

  const openNewListModal = React.useCallback(() => {
    setNewListName("");
    setNewListError(null);
    setDeleteMode(false);
    setNewListModalVisible(true);
  }, []);

  const closeNewListModal = React.useCallback(() => {
    setNewListModalVisible(false);
    setNewListError(null);
  }, []);

  const handleCreateList = React.useCallback(() => {
    const trimmed = newListName.trim();
    if (!trimmed) {
      setNewListError("List name is required.");
      return;
    }

    const duplicate = lists.some((list) => list.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      setNewListError("You already have a list with that name.");
      return;
    }

    try {
      const created = addList(trimmed);
      setSelectedListId(created.id);
      setNewListModalVisible(false);
      setNewListError(null);
      setTimeout(() => {
        galleryRef.current?.scrollToEnd({ animated: true });
      }, 150);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create list.";
      setNewListError(message);
    }
  }, [addList, lists, newListName]);

  const NewListButton = ({ variant = "card" }: { variant?: "card" | "empty" }) => {
    const containerStyles =
      variant === "card"
        ? [styles.galleryAddCard, deleteMode && styles.galleryAddDisabled]
        : [styles.galleryAddCardEmpty, deleteMode && styles.galleryAddDisabled];

    return (
      <Pressable
        onPress={openNewListModal}
        style={containerStyles}
        accessibilityRole="button"
        accessibilityLabel="Create a new list"
        disabled={deleteMode}
      >
        <View style={styles.galleryAddCircle}>
          <FontAwesome name="plus" size={18} color="#0f172a" />
        </View>
        <Text style={styles.galleryAddLabel}>New</Text>
      </Pressable>
    );
  };

  const selectedGroup = React.useMemo(
    () => grouped.find((group) => group.definition.id === selectedListId),
    [grouped, selectedListId],
  );

  const pinsForMap = React.useMemo<SavedEntry[]>(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.wishlist, ...selectedGroup.favourite];
  }, [selectedGroup]);

  const regionForMap = React.useMemo(() => computeRegion(pinsForMap), [pinsForMap]);
  const hasLists = grouped.length > 0;

  return (
    <>
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
          ref={galleryRef}
          horizontal
          data={grouped}
          keyExtractor={(item) => item.definition.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gallery}
          extraData={{ selectedListId, deleteMode }}
          ListFooterComponent={hasLists ? () => <NewListButton /> : undefined}
          ListFooterComponentStyle={styles.galleryFooter}
          ListEmptyComponent={() => (
            <View style={styles.emptyLists}>
              <Text style={styles.emptyListsText}>Create your first list to get started.</Text>
              <NewListButton variant="empty" />
            </View>
          )}
          renderItem={({ item }: { item: GroupedList }) => {
            const total = item.wishlist.length + item.favourite.length;
            const isSelected = item.definition.id === selectedListId;
            const cardWiggleStyle = deleteMode
              ? {
                  transform: [
                    {
                      rotate: wiggleAnim.interpolate({
                        inputRange: [-1, 1],
                        outputRange: ['-2deg', '2deg'],
                      }),
                    },
                  ],
                }
              : undefined;

            const promptRemoval = () => {
              Alert.alert(
                'Remove list?',
                `Are you sure you want to remove "${item.definition.name}"?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      removeList(item.definition.id);
                      setDeleteMode(false);
                    },
                  },
                ],
              );
            };

            return (
              <Animated.View style={[styles.galleryCardWrapper, cardWiggleStyle]}>
                <Pressable
                  style={[styles.galleryCard, isSelected && styles.galleryCardSelected]}
                  onPress={() => {
                    if (deleteMode) {
                      setDeleteMode(false);
                      return;
                    }
                    setSelectedListId(item.definition.id);
                  }}
                  onLongPress={() => {
                    setDeleteMode(true);
                    setSelectedListId(item.definition.id);
                  }}
                  delayLongPress={250}
                >
                  {deleteMode && (
                    <Pressable
                      style={styles.deleteBadge}
                      onPress={(event) => {
                        event.stopPropagation();
                        promptRemoval();
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.deleteBadgeText}>−</Text>
                    </Pressable>
                  )}
                  <Text style={styles.galleryTitle}>{item.definition.name}</Text>
                  <Text style={styles.galleryCount}>{total} saved places</Text>
                </Pressable>
              </Animated.View>
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

      <Modal
        transparent
        visible={newListModalVisible}
        animationType="fade"
        onRequestClose={closeNewListModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeNewListModal} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.newListModalWrapper}
        >
          <View style={styles.newListModal}>
            <Text style={styles.newListTitle}>Create a new list</Text>
            <TextInput
              value={newListName}
              onChangeText={(text) => {
                setNewListName(text);
                if (newListError) setNewListError(null);
              }}
              placeholder="Name your list"
              autoFocus
              style={styles.newListInput}
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={handleCreateList}
            />
            {newListError && <Text style={styles.newListError}>{newListError}</Text>}
            <View style={styles.newListActions}>
              <Pressable
                onPress={closeNewListModal}
                style={[styles.newListButton, styles.newListButtonSecondary]}
              >
                <Text style={styles.newListButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreateList}
                style={[styles.newListButton, styles.newListButtonPrimary]}
              >
                <Text style={styles.newListButtonPrimaryText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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
  galleryFooter: {
    paddingRight: 12,
  },
  galleryCardWrapper: {
    position: 'relative',
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
  galleryAddCard: {
    width: 140,
    height: 120,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  galleryAddCardEmpty: {
    width: 180,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    marginTop: 16,
  },
  galleryAddDisabled: {
    opacity: 0.4,
  },
  galleryAddCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#0f172a',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryAddLabel: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  deleteBadge: {
    position: 'absolute',
    top: -10,
    left: -10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  deleteBadgeText: {
    color: '#ffffff',
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '700',
  },
  emptyLists: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 16,
  },
  emptyListsText: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
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
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  newListModalWrapper: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  newListModal: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  newListTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  newListInput: {
    borderWidth: 1,
    borderColor: '#cbd5f5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
  },
  newListError: {
    fontSize: 13,
    color: '#ef4444',
  },
  newListActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  newListButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  newListButtonPrimary: {
    backgroundColor: '#6366f1',
  },
  newListButtonSecondary: {
    backgroundColor: '#e2e8f0',
  },
  newListButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  newListButtonSecondaryText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '600',
  },
});
