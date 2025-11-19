import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import type { SavedEntry, SavedListDefinition } from "@/shared/context/savedLists";
import { useAuth } from "@/shared/context/auth";

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

  return (
    <ScrollView
      style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}
      contentContainerStyle={styles.contentContainer}
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
        {!isSelf ? <Text style={styles.sectionSubtitle}>Only public lists are visible.</Text> : null}
      </View>

      {groupedLists.length === 0 ? (
        <Text style={styles.emptyState}>
          {isSelf ? "You haven't created any lists yet." : "No public lists to show."}
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
              const visibility = item.definition.visibility ?? "public";
              const visibilityLabel = visibility.charAt(0).toUpperCase() + visibility.slice(1);
              return (
                <Pressable
                  style={[styles.galleryCard, isSelected && styles.galleryCardSelected]}
                  onPress={() => setSelectedListId(item.definition.id)}
                >
                  <Text style={styles.galleryTitle} numberOfLines={2}>
                    {item.definition.name}
                  </Text>
                  <View style={styles.galleryMeta}>
                    <Text style={styles.galleryCount}>
                      {total} {total === 1 ? "place" : "places"}
                    </Text>
                    <View
                      style={[
                        styles.visibilityTag,
                        visibility === "public"
                          ? styles.visibilityTagPublic
                          : visibility === "followers"
                          ? styles.visibilityTagFollowers
                          : styles.visibilityTagPrivate,
                      ]}
                    >
                      <Text style={styles.visibilityTagLabel}>{visibilityLabel}</Text>
                    </View>
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
              <MapView
                key={selectedGroup.definition.id}
                style={styles.detailMap}
                region={regionForMap}
                initialRegion={regionForMap}
              >
                {pinsForMap.map((entry) => (
                  <Marker
                    key={makeEntryKey(entry)}
                    coordinate={{ latitude: entry.pin.lat, longitude: entry.pin.lng }}
                    title={entry.pin.label}
                    pinColor={entry.bucket === "wishlist" ? "#f59e0b" : "#22c55e"}
                  />
                ))}
              </MapView>

              <View style={styles.bucketSection}>
                <Text style={styles.bucketTitle}>Wishlist</Text>
                {selectedGroup.wishlist.length ? (
                  selectedGroup.wishlist.map((entry) => (
                    <Text key={`wish-${makeEntryKey(entry)}`} style={styles.bucketItem}>
                      • {entry.pin.label}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.emptyState}>No wishlist saves yet.</Text>
                )}
              </View>

              <View style={styles.bucketSection}>
                <Text style={styles.bucketTitle}>Favourite</Text>
                {selectedGroup.favourite.length ? (
                  selectedGroup.favourite.map((entry) => (
                    <Text key={`fav-${makeEntryKey(entry)}`} style={styles.bucketItem}>
                      • {entry.pin.label}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.emptyState}>No favourite saves yet.</Text>
                )}
              </View>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
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
  sectionSubtitle: {
    fontSize: 13,
    color: "#94a3b8",
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
  galleryMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  galleryCount: {
    fontSize: 13,
    color: "#475569",
  },
  visibilityTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  visibilityTagPublic: {
    backgroundColor: "rgba(4,120,87,0.12)",
  },
  visibilityTagFollowers: {
    backgroundColor: "rgba(124,45,18,0.12)",
  },
  visibilityTagPrivate: {
    backgroundColor: "rgba(29,78,216,0.12)",
  },
  visibilityTagLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
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
  },
  bucketSection: {
    gap: 8,
  },
  bucketTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  bucketItem: {
    fontSize: 15,
    color: "#1e293b",
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
});
