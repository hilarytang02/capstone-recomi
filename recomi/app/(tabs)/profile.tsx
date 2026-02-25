import React from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
} from "react-native";
import MapView, { Marker, type Region } from "../../components/MapView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import {
  useSavedLists,
  type SavedEntry,
  type SavedListDefinition,
  LIST_VISIBILITY_OPTIONS,
} from "../../shared/context/savedLists";
import { useAuth } from "../../shared/context/auth";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import PinDetailSheet from "../../components/PinDetailSheet";
import { collection, doc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { firestore } from "../../shared/firebase/app";
import { USER_FOLLOWS_COLLECTION, USERS_COLLECTION, type UserDocument } from "../../shared/api/users";

type GroupedList = {
  definition: SavedListDefinition;
  wishlist: SavedEntry[];
  favourite: SavedEntry[];
};

const makeEntryKey = (entry: SavedEntry) =>
  `${entry.listId}-${entry.bucket}-${entry.savedAt}`;


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

// Displays the current user's saved lists, liked lists, and account controls.
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const {
    entries,
    lists,
    removeList,
    addList,
    removeEntry,
    likedLists,
    likedListsVisible,
    setLikedListsVisibility,
    loading: listsLoading,
  } = useSavedLists();
  const [deleteMode, setDeleteMode] = React.useState(false);
  const wiggleAnim = React.useRef(new Animated.Value(0)).current;
  const wiggleLoop = React.useRef<Animated.CompositeAnimation | null>(null);
  const galleryRef = React.useRef<FlatList<GroupedList> | null>(null);
  const previewMapRef = React.useRef<React.ComponentRef<typeof MapView> | null>(null);
  const modalMapRef = React.useRef<React.ComponentRef<typeof MapView> | null>(null);
  const [newListModalVisible, setNewListModalVisible] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  const [newListError, setNewListError] = React.useState<string | null>(null);
  const [newListVisibility, setNewListVisibility] = React.useState<SavedListDefinition["visibility"]>("public");
  const [isEditing, setIsEditing] = React.useState(false);
  const [pendingRemovals, setPendingRemovals] = React.useState<Record<string, SavedEntry>>({});
  const [signingOut, setSigningOut] = React.useState(false);
  const [mapModalVisible, setMapModalVisible] = React.useState(false);
  const [activePinEntry, setActivePinEntry] = React.useState<SavedEntry | null>(null);
  const [expandedLikedId, setExpandedLikedId] = React.useState<string | null>(null);
  const [selfProfile, setSelfProfile] = React.useState<UserDocument | null>(null);
  const [listPickerOpen, setListPickerOpen] = React.useState(false);
  const [listSearch, setListSearch] = React.useState("");
  const [friendsCount, setFriendsCount] = React.useState(0);
  const handleOpenAccountEditor = React.useCallback(() => {
    router.push("/(tabs)/profile-edit");
  }, [router]);
  const handleLikedVisibilityToggle = React.useCallback(
    (value: boolean) => {
      setLikedListsVisibility(value);
    },
    [setLikedListsVisibility],
  );

  // Keep a live copy of the Firestore profile so edits elsewhere reflect immediately.
  // Ensure the gallery always highlights a valid list after reordering/deletion.
  React.useEffect(() => {
    if (!user?.uid) {
      setSelfProfile(null);
      return;
    }
    const ref = doc(firestore, USERS_COLLECTION, user.uid);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      setSelfProfile(snapshot.exists() ? (snapshot.data() as UserDocument) : null);
    });
    return unsubscribe;
  }, [user?.uid]);

  React.useEffect(() => {
    if (!user?.uid) {
      setFriendsCount(0);
      return;
    }
    const loadFriends = async () => {
      const followersSnap = await getDocs(
        query(collection(firestore, USER_FOLLOWS_COLLECTION), where("followeeId", "==", user.uid))
      );
      const followeesSnap = await getDocs(
        query(collection(firestore, USER_FOLLOWS_COLLECTION), where("followerId", "==", user.uid))
      );
      const followers = new Set(
        followersSnap.docs
          .map((docSnap) => (docSnap.data() as { followerId?: string }).followerId)
          .filter((id): id is string => Boolean(id))
      );
      const followees = new Set(
        followeesSnap.docs
          .map((docSnap) => (docSnap.data() as { followeeId?: string }).followeeId)
          .filter((id): id is string => Boolean(id))
      );
      let mutual = 0;
      followers.forEach((id) => {
        if (followees.has(id)) mutual += 1;
      });
      setFriendsCount(mutual);
    };
    void loadFriends().catch((error) => {
      console.warn("Failed to load friends count", error);
      setFriendsCount(0);
    });
  }, [user?.uid]);

  const profileDisplayName = selfProfile?.displayName ?? user?.displayName ?? "Your profile";
  const profileUsername = selfProfile?.username ?? null;
  const profileBio = selfProfile?.bio ?? null;
  const profilePhoto = selfProfile?.photoURL ?? user?.photoURL ?? null;
  const wishlistCount = entries.filter((entry) => entry.bucket === "wishlist").length;
  const favouriteCount = entries.filter((entry) => entry.bucket === "favourite").length;

  // Build gallery-friendly groups so wishlist/favourite pins stay paired with their list definition.
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

  const listById = React.useMemo(() => {
    const map = new Map<string, SavedListDefinition>();
    lists.forEach((list) => {
      map.set(list.id, list);
    });
    return map;
  }, [lists]);

  const listStats = React.useMemo(() => {
    const counts = new Map<string, number>();
    const wishlistCounts = new Map<string, number>();
    const favouriteCounts = new Map<string, number>();
    const recency = new Map<string, number>();
    entries.forEach((entry) => {
      counts.set(entry.listId, (counts.get(entry.listId) ?? 0) + 1);
      if (entry.bucket === "wishlist") {
        wishlistCounts.set(entry.listId, (wishlistCounts.get(entry.listId) ?? 0) + 1);
      }
      if (entry.bucket === "favourite") {
        favouriteCounts.set(entry.listId, (favouriteCounts.get(entry.listId) ?? 0) + 1);
      }
      const last = recency.get(entry.listId) ?? 0;
      if (entry.savedAt > last) {
        recency.set(entry.listId, entry.savedAt);
      }
    });
    return { counts, wishlistCounts, favouriteCounts, recency };
  }, [entries]);

  const MAX_VISIBLE_LISTS = 6;
  const sortedLists = React.useMemo(() => {
    return [...lists].sort((a, b) => {
      const aRecency = listStats.recency.get(a.id) ?? 0;
      const bRecency = listStats.recency.get(b.id) ?? 0;
      if (aRecency === bRecency) return a.name.localeCompare(b.name);
      return bRecency - aRecency;
    });
  }, [lists, listStats.recency]);
  const visibleLists = React.useMemo(
    () => sortedLists.slice(0, MAX_VISIBLE_LISTS),
    [sortedLists],
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
        setIsEditing(false);
        setPendingRemovals({});
      };
    }, [wiggleAnim]),
  );

  const openNewListModal = React.useCallback(() => {
    setNewListName("");
    setNewListError(null);
    setDeleteMode(false);
    setIsEditing(false);
    setPendingRemovals({});
    setNewListVisibility("public");
    setNewListModalVisible(true);
  }, []);

  const closeNewListModal = React.useCallback(() => {
    setNewListModalVisible(false);
    setNewListError(null);
    setNewListVisibility("public");
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
      const created = addList(trimmed, newListVisibility);
      setSelectedListId(created.id);
      setNewListModalVisible(false);
      setNewListError(null);
      setNewListVisibility("public");
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
        ? [styles.galleryAddCompact, deleteMode && styles.galleryAddDisabled]
        : [styles.galleryAddCardEmpty, deleteMode && styles.galleryAddDisabled];

    return (
      <Pressable
        onPress={openNewListModal}
        style={containerStyles}
        accessibilityRole="button"
        accessibilityLabel="Create a new list"
        disabled={deleteMode}
      >
        <Text style={styles.galleryAddPlus}>+</Text>
      </Pressable>
    );
  };

  const selectedGroup = React.useMemo(
    () => grouped.find((group) => group.definition.id === selectedListId),
    [grouped, selectedListId],
  );

  const markEntryForRemoval = React.useCallback(
    (entry: SavedEntry, marked: boolean) => {
      const key = makeEntryKey(entry);
      setPendingRemovals((prev) => {
        if (marked) {
          if (prev[key]) return prev;
          return { ...prev, [key]: entry };
        }
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );

  const handleEntryPress = React.useCallback(
    (entry: SavedEntry) => {
      if (isEditing || deleteMode) return;
      setPendingRemovals({});
      setIsEditing(false);
      setDeleteMode(false);
      focusEntryRegion(entry);
    },
    [deleteMode, focusEntryRegion, isEditing],
  );


  const handleSignOut = React.useCallback(async () => {
    try {
      setSigningOut(true);
      await signOut();
    } catch (err) {
      console.error("Failed to sign out", err);
    } finally {
      setSigningOut(false);
    }
  }, [signOut]);

  if (listsLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  const pinsForMap = React.useMemo<SavedEntry[]>(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.wishlist, ...selectedGroup.favourite];
  }, [selectedGroup]);

  const regionForMap = React.useMemo(() => computeRegion(pinsForMap), [pinsForMap]);
  const hasLists = grouped.length > 0;
  const hasPendingRemovals = React.useMemo(
    () => Object.keys(pendingRemovals).length > 0,
    [pendingRemovals],
  );
  const totalItems = pinsForMap.length;
  const focusRegionOnMaps = React.useCallback(
    (region: Region, duration = 220) => {
      previewMapRef.current?.animateToRegion(region, duration);
      modalMapRef.current?.animateToRegion(region, duration);
    },
    [],
  );

  React.useEffect(() => {
    focusRegionOnMaps(regionForMap, 0);
  }, [regionForMap, focusRegionOnMaps]);

  const focusEntryRegion = React.useCallback(
    (entry: SavedEntry) => {
      const nextLatDelta =
        regionForMap.latitudeDelta <= 0.08
          ? Math.max(regionForMap.latitudeDelta * 0.65, 0.01)
          : regionForMap.latitudeDelta;
      const nextLngDelta =
        regionForMap.longitudeDelta <= 0.08
          ? Math.max(regionForMap.longitudeDelta * 0.65, 0.01)
          : regionForMap.longitudeDelta;
      const region: Region = {
        latitude: entry.pin.lat,
        longitude: entry.pin.lng,
        latitudeDelta: nextLatDelta,
        longitudeDelta: nextLngDelta,
      };
      focusRegionOnMaps(region);
    },
    [focusRegionOnMaps, regionForMap],
  );

  const openExpandedMap = React.useCallback(() => {
    if (!selectedGroup) return;
    setMapModalVisible(true);
  }, [selectedGroup]);

  const closeExpandedMap = React.useCallback(() => {
    setMapModalVisible(false);
  }, []);

  React.useEffect(() => {
    if (mapModalVisible && !selectedGroup) {
      setMapModalVisible(false);
    }
  }, [mapModalVisible, selectedGroup]);

  React.useEffect(() => {
    if (!Object.keys(pendingRemovals).length) return;
    const validKeys = new Set(entries.map(makeEntryKey));
    setPendingRemovals((prev) => {
      if (!Object.keys(prev).length) return prev;
      let changed = false;
      const next: Record<string, SavedEntry> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (validKeys.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [entries]);

  React.useEffect(() => {
    setIsEditing(false);
    setPendingRemovals({});
  }, [selectedListId]);

  const toggleEditing = React.useCallback(() => {
    if (!totalItems) {
      return;
    }
    if (isEditing) {
      setIsEditing(false);
      setPendingRemovals({});
    } else {
      setDeleteMode(false);
      setIsEditing(true);
    }
  }, [isEditing, totalItems]);

  const handleCancelEditing = React.useCallback(() => {
    setPendingRemovals({});
    setIsEditing(false);
  }, []);

  const handleConfirmRemovals = React.useCallback(() => {
    Object.values(pendingRemovals).forEach((entry) => {
      removeEntry(entry.listId, entry.pin);
    });
    setPendingRemovals({});
    setIsEditing(false);
  }, [pendingRemovals, removeEntry]);

  const handleMarkerPress = React.useCallback(
    (entry: SavedEntry) => {
      setActivePinEntry(entry);
      focusEntryRegion(entry);
    },
    [focusEntryRegion],
  );

  const closeActivePinSheet = React.useCallback(() => {
    setActivePinEntry(null);
  }, []);

  React.useEffect(() => {
    if (!selectedGroup) {
      setActivePinEntry(null);
      return;
    }
    setActivePinEntry((current) =>
      current && current.listId === selectedGroup.definition.id ? current : null,
    );
  }, [selectedGroup]);

  React.useEffect(() => {
    if (!likedLists.length) {
      setExpandedLikedId(null);
      return;
    }
    setExpandedLikedId((current) =>
      current && likedLists.some((item) => item.listId === current) ? current : null,
    );
  }, [likedLists]);

  return (
    <View style={styles.screen}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 24 },
        ]}
      >
        <View style={styles.profileHeader}>
          <Pressable
            style={styles.signOutAction}
            onPress={handleSignOut}
            disabled={signingOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={12}
          >
            {signingOut ? (
              <ActivityIndicator size="small" color="#0f172a" />
            ) : (
              <FontAwesome name="sign-out" size={16} color="#475569" />
            )}
          </Pressable>
          <View style={styles.profileInfoRow}>
            {profilePhoto ? (
              <Image source={{ uri: profilePhoto }} style={styles.profileAvatar} />
            ) : (
              <View style={styles.profileAvatarPlaceholder}>
                <Text style={styles.profileAvatarInitial}>
                  {(profileDisplayName ?? "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.profileMetricsBlock}>
              {profileUsername ? (
                <Text style={styles.profileUsername}>@{profileUsername}</Text>
              ) : null}
              <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{wishlistCount}</Text>
                  <Text style={styles.metricLabel}>Wishlist</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{favouriteCount}</Text>
                  <Text style={styles.metricLabel}>Favourite</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricValue}>{friendsCount}</Text>
                  <Text style={styles.metricLabel}>Friends</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.profileDetails}>
            <Text style={styles.profileName}>{profileDisplayName}</Text>
            {profileBio ? <Text style={styles.profileBio}>{profileBio}</Text> : null}
            <View style={styles.profileActions}>
              <Pressable
                style={styles.editAccountButton}
                onPress={handleOpenAccountEditor}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
              >
                <Text style={styles.editAccountLabel}>Edit profile</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <FlatList<SavedListDefinition>
          ref={galleryRef}
          horizontal
          ListHeaderComponent={<NewListButton />}
          data={visibleLists}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gallery}
          extraData={{ selectedListId, deleteMode }}
          ListFooterComponent={
            hasLists
              ? () => (
                  <View style={styles.galleryFooterRow}>
                    {lists.length > MAX_VISIBLE_LISTS ? (
                      <Pressable
                        style={styles.galleryAllChip}
                        onPress={() => {
                          setListSearch("");
                          setListPickerOpen(true);
                        }}
                      >
                        <Text style={styles.galleryAllChipLabel}>All</Text>
                        <View style={styles.galleryAllChipCount}>
                          <Text style={styles.galleryAllChipCountText}>{lists.length}</Text>
                        </View>
                      </Pressable>
                    ) : null}
                  </View>
                )
              : undefined
          }
          ListFooterComponentStyle={styles.galleryFooter}
          ListEmptyComponent={() => (
            <View style={styles.emptyLists}>
              <Text style={styles.emptyListsText}>Create your first list to get started.</Text>
              <NewListButton variant="empty" />
            </View>
          )}
          renderItem={({ item }: { item: SavedListDefinition }) => {
            const total = listStats.counts.get(item.id) ?? 0;
            const isSelected = item.id === selectedListId;
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
                `Are you sure you want to remove "${item.name}"?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      removeList(item.id);
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
                    if (isEditing) {
                      setIsEditing(false);
                      setPendingRemovals({});
                    }
                    setSelectedListId(item.id);
                  }}
                  onLongPress={() => {
                    setDeleteMode(true);
                    setIsEditing(false);
                    setPendingRemovals({});
                    setSelectedListId(item.id);
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
                  <View style={styles.listChipRow}>
                    <Text style={styles.listChipTitle} numberOfLines={1} ellipsizeMode="tail">
                      {item.name}
                    </Text>
                    <View style={styles.listChipCount}>
                      <Text style={styles.listChipCountText}>{total}</Text>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            );
          }}
        />

        {selectedGroup ? (
          <View style={styles.detailSection}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleBlock}>
                <Text style={styles.sectionTitle}>{selectedGroup.definition.name}</Text>
                <Text style={styles.sectionMeta}>
                  Liked by {listById.get(selectedGroup.definition.id)?.savesCount ?? 0}
                </Text>
              </View>
              {!!totalItems && (
                <Pressable
                  style={[styles.editButton, isEditing && styles.editButtonActive]}
                  hitSlop={10}
                  onPress={toggleEditing}
                >
                  <FontAwesome name="pencil" size={16} color={isEditing ? '#ffffff' : '#0f172a'} />
                </Pressable>
              )}
            </View>
            <View style={styles.mapPreviewWrapper}>
              <MapView
                ref={previewMapRef}
                key={selectedListId ?? 'none'}
                style={styles.detailMap}
                initialRegion={regionForMap}
              >
                {pinsForMap.map((entry) => (
                  <Marker
                    key={`${entry.listId}-${entry.bucket}-${entry.savedAt}`}
                    coordinate={{ latitude: entry.pin.lat, longitude: entry.pin.lng }}
                    title={entry.pin.label}
                    pinColor={entry.bucket === 'wishlist' ? '#f59e0b' : '#22c55e'}
                    onPress={() => handleMarkerPress(entry)}
                  />
                ))}
              </MapView>
              {selectedGroup ? (
                <Pressable
                  style={styles.mapExpandOverlay}
                  onPress={openExpandedMap}
                  accessibilityRole="button"
                  accessibilityLabel="Open map with all pins"
                >
                  <View style={styles.mapExpandHint}>
                    <FontAwesome name="expand" size={14} color="#fff" />
                    <Text style={styles.mapExpandHintText}>Open map</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.bucketSection}>
              <Text style={styles.bucketTitle}>Wishlist</Text>
              {selectedGroup.wishlist.length ? (
                selectedGroup.wishlist.map((entry: SavedEntry) => {
                  const entryKey = makeEntryKey(entry);
                  return (
                    <SwipeStrikeItem
                      key={entryKey}
                      label={`• ${entry.pin.label}`}
                      editing={isEditing}
                      marked={Boolean(pendingRemovals[entryKey])}
                      onMarkedChange={(marked) => markEntryForRemoval(entry, marked)}
                      onPress={() => handleEntryPress(entry)}
                    />
                  );
                })
              ) : (
                <Text style={styles.emptyState}>No wishlist saves yet.</Text>
              )}
            </View>

            <View style={styles.bucketSection}>
              <Text style={styles.bucketTitle}>Favourite</Text>
              {selectedGroup.favourite.length ? (
                selectedGroup.favourite.map((entry: SavedEntry) => {
                  const entryKey = makeEntryKey(entry);
                  return (
                    <SwipeStrikeItem
                      key={entryKey}
                      label={`• ${entry.pin.label}`}
                      editing={isEditing}
                      marked={Boolean(pendingRemovals[entryKey])}
                      onMarkedChange={(marked) => markEntryForRemoval(entry, marked)}
                      onPress={() => handleEntryPress(entry)}
                    />
                  );
                })
              ) : (
                <Text style={styles.emptyState}>No favourite saves yet.</Text>
              )}
            </View>

            {isEditing && (
              <View style={styles.editActions}>
                <Pressable onPress={handleCancelEditing} style={styles.editCancelButton} hitSlop={12}>
                  <Text style={styles.editCancelText}>Cancel</Text>
                </Pressable>
                {hasPendingRemovals && (
                  <Pressable
                    onPress={handleConfirmRemovals}
                    style={styles.editDoneButton}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm deletions"
                  >
                    <Text style={styles.editDoneText}>Done</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        ) : null}
        <View style={styles.likedSection}>
          <View style={styles.likedHeader}>
            <Text style={styles.sectionTitle}>Liked Lists</Text>
            <View style={styles.likedToggleRow}>
              <Text style={styles.likedToggleLabel}>
                {likedListsVisible ? "Visible to others" : "Hidden from others"}
              </Text>
              <Switch
                value={likedListsVisible}
                onValueChange={handleLikedVisibilityToggle}
                thumbColor={likedListsVisible ? "#0f172a" : "#e2e8f0"}
                trackColor={{ false: "#cbd5f5", true: "#a5b4fc" }}
              />
            </View>
          </View>
          {likedLists.length ? (
            likedLists.map((item) => {
              const pins = [...item.wishlist, ...item.favourite];
              const region = computeRegion(pins);
              const isExpanded = expandedLikedId === item.listId;
              return (
                <View key={`${item.ownerId}-${item.listId}`} style={styles.likedAccordionCard}>
                  <Pressable
                    style={styles.likedAccordionHeader}
                    onPress={() =>
                      setExpandedLikedId((current) => (current === item.listId ? null : item.listId))
                    }
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.likedCardTitle} numberOfLines={1}>
                        {item.listName}
                      </Text>
                      <Text style={styles.likedCardOwner} numberOfLines={1}>
                        by {item.ownerDisplayName ?? item.ownerUsername ?? "Unknown user"}
                      </Text>
                    </View>
                    <FontAwesome
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={16}
                      color="#0f172a"
                    />
                  </Pressable>
                  {isExpanded ? (
                    <View style={styles.likedAccordionBody}>
                      <MapView
                        style={styles.likedMap}
                        initialRegion={region}
                        key={`${item.listId}-liked-map`}
                      >
                        {pins.map((entry) => (
                          <Marker
                            key={`${item.listId}-pin-${entry.savedAt}`}
                            coordinate={{ latitude: entry.pin.lat, longitude: entry.pin.lng }}
                            title={entry.pin.label}
                            pinColor={entry.bucket === "wishlist" ? "#f59e0b" : "#22c55e"}
                          />
                        ))}
                      </MapView>
                      <View style={styles.likedBucketSection}>
                        <Text style={styles.bucketTitle}>Wishlist</Text>
                        {item.wishlist.length ? (
                          item.wishlist.map((entry) => (
                            <Text key={`liked-wish-${entry.savedAt}`} style={styles.bucketItem}>
                              • {entry.pin.label}
                            </Text>
                          ))
                        ) : (
                          <Text style={styles.emptyState}>No wishlist saves yet.</Text>
                        )}
                      </View>
                      <View style={styles.likedBucketSection}>
                        <Text style={styles.bucketTitle}>Favourite</Text>
                        {item.favourite.length ? (
                          item.favourite.map((entry) => (
                            <Text key={`liked-fav-${entry.savedAt}`} style={styles.bucketItem}>
                              • {entry.pin.label}
                            </Text>
                          ))
                        ) : (
                          <Text style={styles.emptyState}>No favourite saves yet.</Text>
                        )}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyState}>You haven’t liked any lists yet.</Text>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={listPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setListPickerOpen(false)}
      >
        <View style={styles.listPickerOverlay}>
          <View style={styles.listPickerSheet}>
            <View style={styles.listPickerHeader}>
              <Text style={styles.listPickerTitle}>All lists</Text>
              <Pressable onPress={() => setListPickerOpen(false)} hitSlop={8}>
                <Text style={styles.listPickerClose}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.listPickerSearchWrap}>
              <TextInput
                value={listSearch}
                onChangeText={setListSearch}
                placeholder="Search lists"
                style={styles.listPickerSearchInput}
              />
            </View>
            <FlatList
              data={sortedLists.filter((list) =>
                list.name.toLowerCase().includes(listSearch.trim().toLowerCase())
              )}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listPickerList}
              renderItem={({ item }) => {
                const total = listStats.counts.get(item.id) ?? 0;
                const wishlist = listStats.wishlistCounts.get(item.id) ?? 0;
                const favourite = listStats.favouriteCounts.get(item.id) ?? 0;
                const savesCount = item.savesCount ?? 0;
                const isSelected = item.id === selectedListId;
                return (
                  <Pressable
                    style={[styles.listPickerRow, isSelected && styles.listPickerRowActive]}
                    onPress={() => {
                      setSelectedListId(item.id);
                      setListPickerOpen(false);
                    }}
                  >
                    <View style={styles.listPickerIcon}>
                      <FontAwesome name="bookmark" size={14} color="#94a3b8" />
                    </View>
                    <View style={styles.listPickerText}>
                      <Text style={styles.listPickerName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.listPickerMetaText}>
                        {total} places • {wishlist} wishlist • {favourite} favourite • {savesCount} saves
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.listPickerEmpty}>
                  <Text style={styles.listPickerEmptyText}>No lists found.</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      <PinDetailSheet entry={activePinEntry} onClose={closeActivePinSheet} bottomInset={insets.bottom} />

      <Modal
        transparent
        visible={mapModalVisible}
        animationType="fade"
        onRequestClose={closeExpandedMap}
      >
        <View style={styles.mapModalBackdrop}>
          <View style={[styles.mapModalCard, { paddingTop: insets.top + 16 }]}>
            <View style={styles.mapModalHeader}>
              <Text style={styles.mapModalTitle}>
                {selectedGroup?.definition.name ?? "List map"}
              </Text>
              <Pressable
                onPress={closeExpandedMap}
                style={styles.mapModalClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close map"
              >
                <FontAwesome name="close" size={18} color="#0f172a" />
              </Pressable>
            </View>
            <View style={styles.mapModalBody}>
              {selectedGroup ? (
                <MapView
                  ref={modalMapRef}
                  key={selectedGroup.definition.id}
                  style={styles.mapModalMap}
                  initialRegion={regionForMap}
                >
                {pinsForMap.map((entry) => (
                  <Marker
                    key={`${entry.listId}-${entry.bucket}-${entry.savedAt}`}
                    coordinate={{ latitude: entry.pin.lat, longitude: entry.pin.lng }}
                    title={entry.pin.label}
                    pinColor={entry.bucket === "wishlist" ? "#f59e0b" : "#22c55e"}
                    onPress={() => handleMarkerPress(entry)}
                  />
                ))}
                </MapView>
              ) : (
                <View style={styles.mapModalEmpty}>
                  <Text style={styles.mapModalEmptyText}>No places to show.</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>

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
            <View style={styles.visibilitySection}>
              <Text style={styles.visibilityHeading}>Visibility</Text>
              <View style={styles.visibilityOptionsRow}>
                {LIST_VISIBILITY_OPTIONS.map((option) => {
                  const active = newListVisibility === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setNewListVisibility(option.value)}
                      style={[styles.visibilityChip, active && styles.visibilityChipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${option.label} visibility`}
                    >
                      <Text
                        style={[styles.visibilityChipLabel, active && styles.visibilityChipLabelActive]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.visibilityChipHelper}>{option.helper}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
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
    </View>
  );
}

type SwipeStrikeItemProps = {
  label: string;
  editing: boolean;
  marked: boolean;
  onMarkedChange: (marked: boolean) => void;
  onPress?: () => void;
};

const STRIKE_THRESHOLD = 60;

function SwipeStrikeItem({ label, editing, marked, onMarkedChange, onPress }: SwipeStrikeItemProps) {
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          editing &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
          Math.abs(gestureState.dx) > 6,
        onPanResponderMove: () => {},
        onPanResponderRelease: (_, gestureState) => {
          if (!editing) return;
          const offset = gestureState.dx;
          if (offset >= STRIKE_THRESHOLD) {
            onMarkedChange(true);
          } else if (offset <= -STRIKE_THRESHOLD) {
            onMarkedChange(false);
          } else {
            onMarkedChange(marked);
          }
        },
        onPanResponderTerminate: (_, gestureState) => {
          const offset = gestureState.dx;
          if (offset >= STRIKE_THRESHOLD) {
            onMarkedChange(true);
          } else if (offset <= -STRIKE_THRESHOLD) {
            onMarkedChange(false);
          } else {
            // unchanged
          }
        },
      }),
    [editing, marked, onMarkedChange],
  );

  const showPressable = Boolean(onPress);

  return (
    <Animated.View
      style={[
        styles.bucketItemWrapper,
        editing && styles.bucketItemWrapperEditing,
      ]}
      {...(editing ? panResponder.panHandlers : {})}
    >
      <Pressable
        disabled={!showPressable || editing}
        onPress={onPress}
        style={styles.bucketItemPressable}
      >
        <View style={styles.bucketItemContent}>
          <Text
            style={[
              styles.bucketItem,
              marked && styles.bucketItemStruck,
            ]}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loader: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
    backgroundColor: '#f8fafc',
    gap: 16,
  },
  profileHeader: {
    gap: 16,
    position: 'relative',
  },
  signOutAction: {
    position: 'absolute',
    top: -2,
    right: -4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  profileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  profileAvatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarInitial: {
    fontSize: 26,
    fontWeight: '700',
    color: '#475569',
  },
  profileMetricsBlock: {
    flex: 1,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  profileUsername: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 8,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  profileBio: {
    fontSize: 14,
    color: '#0f172a',
    marginTop: 6,
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  metricItem: {
    gap: 4,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  profileDetails: {
    gap: 8,
  },
  profileActions: {
    flexDirection: 'row',
    marginTop: 4,
  },
  editAccountButton: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  editAccountLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  headerCopy: {
    flexShrink: 1,
    gap: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
  },
  gallery: {
    gap: 10,
    paddingVertical: 6,
  },
  galleryFooter: {
    paddingRight: 12,
  },
  galleryFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  galleryAllChip: {
    height: 50,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#cbd5f5',
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  galleryAllChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  galleryAllChipCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryAllChipCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338ca',
  },
  galleryAddCompact: {
    width: 68,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5f5',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  galleryAddPlus: {
    fontSize: 20,
    fontWeight: '600',
    color: '#64748b',
  },
  galleryCardWrapper: {
    position: 'relative',
  },
  galleryCard: {
    width: 160,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    minHeight: 50,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  galleryCardSelected: {
    borderColor: '#c7d2fe',
    backgroundColor: '#f8faff',
    borderBottomWidth: 2,
    borderBottomColor: '#818cf8',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  listChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listChipTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  listChipCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listChipCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  listPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'flex-end',
  },
  listPickerSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: '75%',
  },
  listPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  listPickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  listPickerClose: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  listPickerSearchWrap: {
    marginBottom: 12,
  },
  listPickerSearchInput: {
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  listPickerList: {
    paddingBottom: 24,
    gap: 8,
  },
  listPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  listPickerRowActive: {
    backgroundColor: '#f1f5f9',
  },
  listPickerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listPickerText: {
    flex: 1,
    gap: 2,
  },
  listPickerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  listPickerMetaText: {
    fontSize: 12,
    color: '#64748b',
  },
  listPickerEmpty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  listPickerEmptyText: {
    fontSize: 12,
    color: '#94a3b8',
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
  sectionTitleBlock: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  editButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#cbd5f5',
    backgroundColor: '#f8fafc',
  },
  editButtonActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  detailMap: {
    height: 220,
    borderRadius: 16,
    width: '100%',
  },
  mapPreviewWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  mapExpandOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 12,
  },
  mapExpandHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15,23,42,0.75)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  mapExpandHintText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  likedSection: {
    marginTop: 24,
    gap: 12,
  },
  likedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  likedToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  likedToggleLabel: {
    fontSize: 13,
    color: '#475569',
  },
  likedAccordionCard: {
    borderRadius: 18,
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  likedAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  likedAccordionBody: {
    marginTop: 12,
    gap: 12,
  },
  likedMap: {
    height: 180,
    borderRadius: 14,
  },
  likedBucketSection: {
    gap: 6,
  },
  likedCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  likedCardOwner: {
    fontSize: 14,
    color: '#475569',
    marginTop: 6,
  },
  likedCardDescription: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 8,
  },
  mapModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.85)',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  mapModalCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 16,
  },
  mapModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
    marginRight: 12,
  },
  mapModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  mapModalBody: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  mapModalMap: {
    flex: 1,
  },
  mapModalEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  mapModalEmptyText: {
    color: '#94a3b8',
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
  bucketItemStruck: {
    textDecorationLine: 'line-through',
    textDecorationColor: '#cbd5f5',
  },
  bucketItemWrapper: {
    paddingVertical: 6,
    position: 'relative',
  },
  bucketItemWrapperEditing: {
    paddingVertical: 10,
  },
  bucketItemPressable: {
    borderRadius: 8,
  },
  bucketItemContent: {
    position: 'relative',
    paddingHorizontal: 4,
  },
  emptyState: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  editCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  editCancelText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  editDoneButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#6366f1',
  },
  editDoneText: {
    color: '#ffffff',
    fontWeight: '700',
    letterSpacing: 0.4,
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
  visibilitySection: {
    marginTop: 16,
    gap: 12,
  },
  visibilityHeading: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  visibilityOptionsRow: {
    gap: 10,
    flexDirection: 'column',
  },
  visibilityChip: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    gap: 4,
    width: '100%',
  },
  visibilityChipActive: {
    borderColor: '#6366f1',
    backgroundColor: '#eef2ff',
  },
  visibilityChipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  visibilityChipLabelActive: {
    color: '#4338ca',
  },
  visibilityChipHelper: {
    fontSize: 12,
    color: '#64748b',
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
