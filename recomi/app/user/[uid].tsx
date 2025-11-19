import React from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, onSnapshot } from "firebase/firestore";

import { firestore } from "@/shared/firebase/app";
import { USERS_COLLECTION, canViewList, followUser, getFollowCounts, isFollowing, type UserDocument, unfollowUser } from "@/shared/api/users";
import MapView, { Marker, type Region } from "@/components/MapView";
import { useSavedLists, type LikedListRef, type SavedEntry, type SavedListDefinition } from "@/shared/context/savedLists";
import { useAuth } from "@/shared/context/auth";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import PinDetailSheet from "@/components/PinDetailSheet";

type UserProfileData = UserDocument & {
  id: string;
};

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

export default function UserProfileScreen() {
  const { uid } = useLocalSearchParams<{ uid?: string | string[] }>();
  const resolvedUid = Array.isArray(uid) ? uid[0] : uid;
  const { user } = useAuth();
  const { likedLists: myLikedLists, likeList, unlikeList } = useSavedLists();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = React.useState<UserProfileData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isFollowingUser, setIsFollowingUser] = React.useState<boolean | null>(null);
  const [followStatusLoading, setFollowStatusLoading] = React.useState(false);
  const [followBusy, setFollowBusy] = React.useState(false);
  const [followError, setFollowError] = React.useState<string | null>(null);
  const [followersCount, setFollowersCount] = React.useState<number>(0);
  const [followingCount, setFollowingCount] = React.useState<number>(0);
  const [countsLoading, setCountsLoading] = React.useState(true);
  const [countsRefreshKey, setCountsRefreshKey] = React.useState(0);
  const [mapModalVisible, setMapModalVisible] = React.useState(false);
  const [activePinEntry, setActivePinEntry] = React.useState<SavedEntry | null>(null);
  const previewMapRef = React.useRef<React.ComponentRef<typeof MapView> | null>(null);
  const modalMapRef = React.useRef<React.ComponentRef<typeof MapView> | null>(null);
  const feedbackAnim = React.useRef(new Animated.Value(0)).current;
  const [feedbackMessage, setFeedbackMessage] = React.useState<string | null>(null);
  const feedbackTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (!resolvedUid) {
      setError("No user specified.");
      setLoading(false);
      return;
    }

    const ref = doc(firestore, USERS_COLLECTION, resolvedUid);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          setProfile(null);
          setError("User not found.");
        } else {
          setProfile({ id: snapshot.id, ...(snapshot.data() as UserDocument) });
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load user profile", err);
        setError("Unable to load this profile right now.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [resolvedUid]);

  const isSelf = user?.uid === resolvedUid;
  const canFollow = Boolean(user && resolvedUid && !isSelf);

  const lists = React.useMemo(() => {
    if (!profile?.lists || !Array.isArray(profile.lists)) return [] as SavedListDefinition[];
    return profile.lists as SavedListDefinition[];
  }, [profile?.lists]);

  const entries = React.useMemo(() => {
    if (!profile?.entries || !Array.isArray(profile.entries)) return [] as SavedEntry[];
    return profile.entries as SavedEntry[];
  }, [profile?.entries]);

  const likedListsFromProfile = React.useMemo<LikedListRef[]>(() => {
    if (!profile?.likedLists || !Array.isArray(profile.likedLists)) return [];
    return profile.likedLists as LikedListRef[];
  }, [profile?.likedLists]);

  const likedListsVisible = profile?.likedListsVisible !== false;

  const entriesByList = React.useMemo(() => {
    return entries.reduce<Record<string, SavedEntry[]>>((acc, entry) => {
      acc[entry.listId] = acc[entry.listId] ? [...acc[entry.listId], entry] : [entry];
      return acc;
    }, {});
  }, [entries]);

  const visibleLists = React.useMemo(() => {
    return lists.filter((list) =>
      canViewList(list.visibility, { isSelf, isFollower: Boolean(isFollowingUser) })
    );
  }, [isFollowingUser, isSelf, lists]);

  const groupedLists = React.useMemo<GroupedList[]>(() => {
    return visibleLists.map((definition) => {
      const related = entriesByList[definition.id] ?? [];
      return {
        definition,
        wishlist: related.filter((entry) => entry.bucket === "wishlist"),
        favourite: related.filter((entry) => entry.bucket === "favourite"),
      };
    });
  }, [entriesByList, visibleLists]);

  const [selectedListId, setSelectedListId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!visibleLists.length) {
      setSelectedListId(null);
      return;
    }
    if (!selectedListId || !visibleLists.some((list) => list.id === selectedListId)) {
      setSelectedListId(visibleLists[0].id);
    }
  }, [selectedListId, visibleLists]);

  const selectedGroup = React.useMemo(
    () => groupedLists.find((group) => group.definition.id === selectedListId),
    [groupedLists, selectedListId]
  );

  const pinsForMap = React.useMemo<SavedEntry[]>(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.wishlist, ...selectedGroup.favourite];
  }, [selectedGroup]);

  const regionForMap = React.useMemo(() => computeRegion(pinsForMap), [pinsForMap]);
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

  const canShowLikedLists = likedListsFromProfile.length > 0 && (isSelf || likedListsVisible);

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

  const handleEntryFocus = React.useCallback(
    (entry: SavedEntry) => {
      focusEntryRegion(entry);
    },
    [focusEntryRegion],
  );

  const showFeedback = React.useCallback(
    (message: string) => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      setFeedbackMessage(message);
      Animated.timing(feedbackAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        feedbackTimeoutRef.current = setTimeout(() => {
          Animated.timing(feedbackAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) {
              setFeedbackMessage(null);
            }
          });
        }, 1500);
      });
    },
    [feedbackAnim],
  );

  React.useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

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

  const isListLiked = React.useCallback(
    (ownerId: string, listId: string) =>
      myLikedLists.some((entry) => entry.ownerId === ownerId && entry.listId === listId),
    [myLikedLists],
  );

  const handleToggleListLike = React.useCallback(
    (definition: SavedListDefinition) => {
      if (!profile) return;
      if (!user) {
        Alert.alert("Sign in to star lists", "You need to be signed in to like lists.");
        return;
      }
      if (isListLiked(profile.id, definition.id)) {
        unlikeList(profile.id, definition.id);
        showFeedback("Removed from liked lists");
      } else {
        const related = entriesByList[definition.id] ?? [];
        const wishlistEntries = related
          .filter((entry) => entry.bucket === "wishlist")
          .map((entry) => ({ ...entry }));
        const favouriteEntries = related
          .filter((entry) => entry.bucket === "favourite")
          .map((entry) => ({ ...entry }));
        likeList({
          ownerId: profile.id,
          ownerDisplayName: profile.displayName ?? profile.username ?? profile.email ?? null,
          ownerUsername: profile.username ?? null,
          listId: definition.id,
          listName: definition.name,
          description: definition.description ?? null,
          wishlist: wishlistEntries,
          favourite: favouriteEntries,
        });
        showFeedback("Added to liked lists");
      }
    },
    [entriesByList, isListLiked, likeList, profile, showFeedback, unlikeList, user],
  );

  React.useEffect(() => {
    if (mapModalVisible && !selectedGroup) {
      setMapModalVisible(false);
    }
  }, [mapModalVisible, selectedGroup]);

  React.useEffect(() => {
    if (!selectedGroup) {
      setActivePinEntry(null);
      return;
    }
    setActivePinEntry((entry) =>
      entry && entry.listId === selectedGroup.definition.id ? entry : null,
    );
  }, [selectedGroup]);

  React.useEffect(() => {
    let active = true;
    const loadCounts = async () => {
      if (!resolvedUid) {
        if (active) {
          setFollowersCount(0);
          setFollowingCount(0);
          setCountsLoading(false);
        }
        return;
      }
      setCountsLoading(true);
      try {
        const counts = await getFollowCounts(resolvedUid);
        if (active) {
          setFollowersCount(counts.followers);
          setFollowingCount(counts.following);
        }
      } catch (err) {
        if (active) {
          console.error("Failed to load follow counts", err);
        }
      } finally {
        if (active) {
          setCountsLoading(false);
        }
      }
    };
    void loadCounts();
    return () => {
      active = false;
    };
  }, [resolvedUid, countsRefreshKey]);

  React.useEffect(() => {
    if (!canFollow || !user || !resolvedUid) {
      setIsFollowingUser(null);
      setFollowStatusLoading(false);
      return;
    }

    let cancelled = false;
    setFollowStatusLoading(true);
    setFollowError(null);
    isFollowing(user.uid, resolvedUid)
      .then((result) => {
        if (!cancelled) {
          setIsFollowingUser(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to check follow state", err);
          setFollowError("Unable to determine follow status.");
          setIsFollowingUser(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFollowStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canFollow, resolvedUid, user]);

  const handleFollowToggle = React.useCallback(async () => {
    if (!canFollow || !resolvedUid || !user) {
      setFollowError("Sign in to follow people.");
      return;
    }
    if (followBusy || followStatusLoading) return;

    const currentlyFollowing = Boolean(isFollowingUser);
    setFollowBusy(true);
    setFollowError(null);
    try {
      if (currentlyFollowing) {
        await unfollowUser(user.uid, resolvedUid);
        setIsFollowingUser(false);
      } else {
        await followUser(user.uid, resolvedUid);
        setIsFollowingUser(true);
      }
      setCountsRefreshKey((key) => key + 1);
    } catch (err) {
      console.error("Failed to update follow status", err);
      setFollowError(err instanceof Error ? err.message : "Unable to update follow status.");
    } finally {
      setFollowBusy(false);
    }
  }, [canFollow, followBusy, followStatusLoading, isFollowingUser, resolvedUid, user]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0f172a" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "User not found."}</Text>
      </View>
    );
  }

  const scrollTopPadding = Math.max(insets.top, 16) + (feedbackMessage ? 40 : 0);

  return (
    <View style={styles.screen}>
      {feedbackMessage ? (
        <Animated.View
          style={[
            styles.feedbackBanner,
            {
              top: Math.max(insets.top, 16),
              opacity: feedbackAnim,
              transform: [
                {
                  translateY: feedbackAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-10, 0],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.feedbackText}>{feedbackMessage}</Text>
        </Animated.View>
      ) : null}
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingTop: scrollTopPadding },
        ]}
      >
        <View style={styles.header}>
        {profile.photoURL ? (
          <Image source={{ uri: profile.photoURL }} style={styles.avatar} />
        ) : (
          <View style={styles.placeholderAvatar}>
            <Text style={styles.placeholderInitial}>
              {(profile.displayName ?? profile.username ?? profile.email ?? "?")
                .slice(0, 1)
                .toUpperCase()}
            </Text>
          </View>
        )}

        <View style={styles.headerText}>
          <Text style={styles.displayName}>
            {profile.displayName ?? profile.username ?? "Unknown user"}
          </Text>
          {profile.username ? <Text style={styles.username}>@{profile.username}</Text> : null}
          {profile.homeCity ? <Text style={styles.meta}>{profile.homeCity}</Text> : null}
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="Followers" value={followersCount} />
        <Stat label="Following" value={followingCount} />
        <Stat label="Lists" value={visibleLists.length} />
      </View>
      {countsLoading ? <Text style={styles.countsHint}>Updating stats…</Text> : null}

      {canFollow ? (
        <View>
          <Pressable
            style={[
              styles.followButton,
              isFollowingUser ? styles.followButtonSecondary : styles.followButtonPrimary,
              (followBusy || followStatusLoading) && styles.followButtonDisabled,
            ]}
            disabled={followBusy || followStatusLoading}
            onPress={handleFollowToggle}
          >
            <Text
              style={isFollowingUser ? styles.followLabelSecondary : styles.followLabelPrimary}
            >
              {followStatusLoading ? "..." : isFollowingUser ? "Following" : "Follow"}
            </Text>
          </Pressable>
          {followError ? <Text style={styles.followError}>{followError}</Text> : null}
        </View>
      ) : null}

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Lists</Text>
      </View>

      {groupedLists.length === 0 ? (
        <Text style={styles.emptyState}>
          {isSelf ? "You haven't created any lists yet." : "No lists to show yet."}
        </Text>
      ) : (
        <>
          <FlatList
            data={groupedLists}
            horizontal
            keyExtractor={(item) => item.definition.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.gallery}
          renderItem={({ item }) => {
            const total = item.wishlist.length + item.favourite.length;
            const isSelected = item.definition.id === selectedListId;
            const likedByMe = profile ? isListLiked(profile.id, item.definition.id) : false;
            return (
              <Pressable
                style={[styles.galleryCard, isSelected && styles.galleryCardSelected]}
                onPress={() => setSelectedListId(item.definition.id)}
              >
                <Pressable
                  style={[styles.cardStarButton, likedByMe && styles.cardStarButtonActive]}
                  onPress={(event) => {
                    event.stopPropagation();
                    handleToggleListLike(item.definition);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={likedByMe ? "Unstar list" : "Star list"}
                >
                  <FontAwesome
                    name={likedByMe ? "star" : "star-o"}
                    size={16}
                    color={likedByMe ? "#f59e0b" : "#0f172a"}
                  />
                </Pressable>
                <Text style={styles.galleryTitle} numberOfLines={2}>
                  {item.definition.name}
                </Text>
                <View style={styles.galleryMeta}>
                  <Text style={styles.galleryCount}>
                      {total} {total === 1 ? "place" : "places"}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />

          {selectedGroup ? (
            <View style={styles.detailSection}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{selectedGroup.definition.name}</Text>
                {selectedGroup.definition.description ? (
                  <Text style={styles.listDescription}>{selectedGroup.definition.description}</Text>
                ) : null}
                <Text style={styles.listMeta}>
                  {totalItems} {totalItems === 1 ? "place saved" : "places saved"}
                </Text>
              </View>
              <View style={styles.mapPreviewWrapper}>
                <MapView
                  ref={previewMapRef}
                  key={selectedGroup.definition.id}
                  style={styles.detailMap}
                  initialRegion={regionForMap}
                >
                {pinsForMap.map((entry) => (
                  <Marker
                    key={makeEntryKey(entry)}
                    coordinate={{ latitude: entry.pin.lat, longitude: entry.pin.lng }}
                    title={entry.pin.label}
                    pinColor={entry.bucket === "wishlist" ? "#f59e0b" : "#22c55e"}
                    onPress={() => handleMarkerPress(entry)}
                  />
                ))}
              </MapView>
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
              </View>

              <View style={styles.bucketSection}>
                <Text style={styles.bucketTitle}>Wishlist</Text>
                {selectedGroup.wishlist.length ? (
                  selectedGroup.wishlist.map((entry) => (
                    <Pressable
                      key={`wish-${makeEntryKey(entry)}`}
                      onPress={() => handleEntryFocus(entry)}
                      style={styles.bucketItemButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Focus map on ${entry.pin.label}`}
                    >
                      <Text style={styles.bucketItem}>• {entry.pin.label}</Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.emptyState}>No wishlist saves yet.</Text>
                )}
              </View>

              <View style={styles.bucketSection}>
                <Text style={styles.bucketTitle}>Favourite</Text>
                {selectedGroup.favourite.length ? (
                  selectedGroup.favourite.map((entry) => (
                    <Pressable
                      key={`fav-${makeEntryKey(entry)}`}
                      onPress={() => handleEntryFocus(entry)}
                      style={styles.bucketItemButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Focus map on ${entry.pin.label}`}
                    >
                      <Text style={styles.bucketItem}>• {entry.pin.label}</Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.emptyState}>No favourite saves yet.</Text>
                )}
              </View>
            </View>
          ) : null}
        </>
      )}
      {canShowLikedLists ? (
        <View style={styles.likedSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Liked Lists</Text>
            {!likedListsVisible && isSelf ? (
              <Text style={styles.likedHiddenLabel}>Hidden from visitors</Text>
            ) : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.likedScroll}
          >
            {likedListsFromProfile.map((item) => (
              <View key={`${item.ownerId}-${item.listId}`} style={styles.likedCard}>
                <Text style={styles.likedCardTitle} numberOfLines={2}>
                  {item.listName}
                </Text>
                <Text style={styles.likedCardOwner} numberOfLines={1}>
                  by {item.ownerDisplayName ?? item.ownerUsername ?? "Unknown user"}
                </Text>
                {item.description ? (
                  <Text style={styles.likedCardDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
      </ScrollView>

      <PinDetailSheet entry={activePinEntry} onClose={closeActivePinSheet} bottomInset={insets.bottom} />

      <Modal
        transparent
        visible={mapModalVisible}
        animationType="fade"
        onRequestClose={closeExpandedMap}
      >
        <View style={styles.mapModalBackdrop}>
          <View style={[styles.mapModalCard, { paddingTop: Math.max(insets.top, 16) }]}>
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
                  key={`${selectedGroup.definition.id}-expanded`}
                  style={styles.mapModalMap}
                  initialRegion={regionForMap}
                >
                  {pinsForMap.map((entry) => (
                    <Marker
                      key={makeEntryKey(entry)}
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
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 20,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 16,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  placeholderAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderInitial: {
    fontSize: 32,
    fontWeight: "600",
    color: "#475569",
  },
  headerText: {
    flex: 1,
  },
  displayName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0f172a",
  },
  username: {
    fontSize: 16,
    color: "#475569",
    marginTop: 4,
  },
  meta: {
    color: "#64748b",
    marginTop: 8,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 16,
    backgroundColor: "#fff",
    padding: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  stat: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
  },
  statLabel: {
    marginTop: 4,
    fontSize: 13,
    color: "#64748b",
  },
  countsHint: {
    marginTop: -12,
    marginBottom: 8,
    textAlign: "right",
    fontSize: 12,
    color: "#94a3b8",
  },
  bio: {
    fontSize: 16,
    lineHeight: 22,
    color: "#1e293b",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
  },
  emptyState: {
    fontSize: 15,
    color: "#94a3b8",
  },
  listDescription: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 8,
  },
  listMeta: {
    fontSize: 13,
    color: "#94a3b8",
  },
  gallery: {
    gap: 12,
    paddingBottom: 8,
  },
  galleryCard: {
    width: 170,
    borderRadius: 16,
    backgroundColor: "#fff",
    padding: 16,
    marginRight: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  galleryCardSelected: {
    borderWidth: 2,
    borderColor: "#0f172a",
  },
  galleryTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 12,
  },
  cardStarButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardStarButtonActive: {
    backgroundColor: "rgba(250,204,21,0.15)",
    borderColor: "#fbbf24",
  },
  galleryMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  galleryCount: {
    fontSize: 13,
    color: "#475569",
  },
  detailSection: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    gap: 18,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  detailHeader: {
    gap: 6,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  detailMap: {
    height: 220,
    borderRadius: 16,
    width: "100%",
  },
  mapPreviewWrapper: {
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
  },
  mapExpandOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 12,
  },
  mapExpandHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(15,23,42,0.75)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  mapExpandHintText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  bucketSection: {
    gap: 8,
  },
  bucketTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  bucketItemButton: {
    paddingVertical: 4,
  },
  bucketItem: {
    fontSize: 15,
    color: "#1e293b",
  },
  likedSection: {
    marginTop: 24,
    gap: 12,
  },
  likedHiddenLabel: {
    fontSize: 12,
    color: "#94a3b8",
  },
  likedScroll: {
    gap: 12,
    paddingVertical: 4,
  },
  likedCard: {
    width: 200,
    borderRadius: 18,
    backgroundColor: "#fff",
    padding: 16,
    marginRight: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  likedCardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  likedCardOwner: {
    fontSize: 14,
    color: "#475569",
    marginTop: 6,
  },
  likedCardDescription: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 8,
  },
  followButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  followButtonPrimary: {
    backgroundColor: "#0f172a",
  },
  followButtonSecondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd5f5",
  },
  followButtonDisabled: {
    opacity: 0.6,
  },
  followLabelPrimary: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  followLabelSecondary: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
  },
  followError: {
    marginTop: 6,
    color: "#b91c1c",
    textAlign: "center",
  },
  feedbackBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 20,
    borderRadius: 16,
    backgroundColor: "#0f172a",
    paddingVertical: 10,
    paddingHorizontal: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  feedbackText: {
    color: "#fff",
    fontWeight: "600",
    textAlign: "center",
  },
  mapModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.85)",
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  mapModalCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 16,
  },
  mapModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mapModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    flex: 1,
    marginRight: 12,
  },
  mapModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e2e8f0",
  },
  mapModalBody: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  mapModalMap: {
    flex: 1,
  },
  mapModalEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  mapModalEmptyText: {
    color: "#94a3b8",
  },
});
