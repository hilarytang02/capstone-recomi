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
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, doc, getCountFromServer, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";

import { firestore } from "@/shared/firebase/app";
import {
  USERS_COLLECTION,
  USER_FOLLOWS_COLLECTION,
  canViewList,
  followUser,
  getFollowCounts,
  isFollowing,
  type UserDocument,
  unfollowUser,
} from "@/shared/api/users";
import MapView, { Marker, type Region } from "@/components/MapView";
import { useSavedLists, type LikedListRef, type SavedEntry, type SavedListDefinition } from "@/shared/context/savedLists";
import { useAuth } from "@/shared/context/auth";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import PinDetailSheet from "@/components/PinDetailSheet";
import { SavedPlaceMarkerIcon } from "@/components/SavedPlaceMarkerIcon";
import RemoteAvatar from "@/components/RemoteAvatar";
import ReportModal from "@/components/ReportModal";
import { useModeration } from "@/shared/context/moderation";
import { createReport } from "@/shared/api/moderation";

type UserProfileData = UserDocument & {
  id: string;
};

type GroupedList = {
  definition: SavedListDefinition;
  wishlist: SavedEntry[];
  favourite: SavedEntry[];
};

type ProfileLite = {
  id: string;
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
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

// Public profile view with follow controls, likes, and shared map pins.
export default function UserProfileScreen() {
  const { uid } = useLocalSearchParams<{ uid?: string | string[] }>();
  const resolvedUid = Array.isArray(uid) ? uid[0] : uid;
  const { user } = useAuth();
  const { blockedUserIds, isBlockedUser, block, unblock } = useModeration();
  const router = useRouter();
  const { likedLists: myLikedLists, likeList, unlikeList, requestMapFocus } = useSavedLists();
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
  const [followModalOpen, setFollowModalOpen] = React.useState(false);
  const [followModalTab, setFollowModalTab] = React.useState<"followers" | "following">("followers");
  const [followersList, setFollowersList] = React.useState<ProfileLite[]>([]);
  const [followingList, setFollowingList] = React.useState<ProfileLite[]>([]);
  const [followLoading, setFollowLoading] = React.useState(false);
  const [mapModalVisible, setMapModalVisible] = React.useState(false);
  const [activePinEntry, setActivePinEntry] = React.useState<SavedEntry | null>(null);
  const [expandedLikedId, setExpandedLikedId] = React.useState<string | null>(null);
  const [listPickerOpen, setListPickerOpen] = React.useState(false);
  const [listSearch, setListSearch] = React.useState("");
  const [likedByCount, setLikedByCount] = React.useState<number | null>(null);
  const [subcollectionLists, setSubcollectionLists] = React.useState<SavedListDefinition[] | null>(null);
  const previewMapRef = React.useRef<React.ComponentRef<typeof MapView> | null>(null);
  const modalMapRef = React.useRef<React.ComponentRef<typeof MapView> | null>(null);
  const feedbackAnim = React.useRef(new Animated.Value(0)).current;
  const [feedbackMessage, setFeedbackMessage] = React.useState<string | null>(null);
  const feedbackTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const [reportUserVisible, setReportUserVisible] = React.useState(false);
  const [reportListVisible, setReportListVisible] = React.useState(false);
  const [reportReason, setReportReason] = React.useState("");
  const [reportSubmitting, setReportSubmitting] = React.useState(false);
  const [blockBusy, setBlockBusy] = React.useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false);
  const [listMenuOpen, setListMenuOpen] = React.useState(false);

  // Live subscriptions keep profile + list data fresh while viewing someone else.
  React.useEffect(() => {
    if (!resolvedUid) {
      setError("No user specified.");
      setLoading(false);
      return;
    }

    let active = true;
    const ref = doc(firestore, USERS_COLLECTION, resolvedUid);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!active) {
          return;
        }
        if (!snapshot.exists()) {
          setProfile(null);
          setError("User not found.");
          setFollowersCount(0);
          setFollowingCount(0);
        } else {
          const data = snapshot.data() as UserDocument;
          setProfile({ id: snapshot.id, ...data });
          const hasFollowersCount = typeof data.followersCount === "number";
          const hasFollowingCount = typeof data.followingCount === "number";
          setFollowersCount(hasFollowersCount ? data.followersCount : 0);
          setFollowingCount(hasFollowingCount ? data.followingCount : 0);
          if (resolvedUid && user && (!hasFollowersCount || !hasFollowingCount)) {
            void getFollowCounts(resolvedUid)
              .then((counts) => {
                if (!active) return;
                setFollowersCount(counts.followers);
                setFollowingCount(counts.following);
              })
              .catch((err) => {
                if (!active) return;
                console.error("Failed to load follow counts", err);
              });
          }
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        if (!active) {
          return;
        }
        console.error("Failed to load user profile", err);
        setError("Unable to load this profile right now.");
        setFollowersCount(0);
        setFollowingCount(0);
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [resolvedUid]);

  React.useEffect(() => {
    if (!resolvedUid) {
      setSubcollectionLists(null);
      return;
    }

    const listsRef = collection(firestore, USERS_COLLECTION, resolvedUid, "lists");
    const unsubscribe = onSnapshot(
      listsRef,
      (snapshot) => {
        const nextLists = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Omit<SavedListDefinition, "id">;
          return {
            id: docSnap.id,
            name: data.name ?? "Untitled",
            description: data.description,
            coverImage: data.coverImage,
            savesCount: typeof data.savesCount === "number" ? data.savesCount : 0,
            visibility: data.visibility ?? "public",
          } as SavedListDefinition;
        });
        setSubcollectionLists(nextLists);
      },
      (err) => {
        console.warn("Failed to load user lists subcollection", err);
        setSubcollectionLists(null);
      },
    );

    return unsubscribe;
  }, [resolvedUid]);

  const isSelf = user?.uid === resolvedUid;
  const canFollow = Boolean(user && resolvedUid && !isSelf);
  const isBlocked = isBlockedUser(resolvedUid);

  const legacyLists = React.useMemo(() => {
    if (!profile?.lists || !Array.isArray(profile.lists)) return [] as SavedListDefinition[];
    return profile.lists as SavedListDefinition[];
  }, [profile?.lists]);

  const lists = React.useMemo(() => {
    if (subcollectionLists && subcollectionLists.length > 0) {
      return subcollectionLists;
    }
    if (legacyLists.length > 0) {
      return legacyLists;
    }
    return subcollectionLists ?? [];
  }, [legacyLists, subcollectionLists]);

  const entries = React.useMemo(() => {
    if (!profile?.entries || !Array.isArray(profile.entries)) return [] as SavedEntry[];
    return profile.entries as SavedEntry[];
  }, [profile?.entries]);

  const likedListsFromProfile = React.useMemo<LikedListRef[]>(() => {
    if (!profile?.likedLists || !Array.isArray(profile.likedLists)) return [];
    return profile.likedLists as LikedListRef[];
  }, [profile?.likedLists]);

  const likedListsVisible = profile?.likedListsVisible !== false;
  const [activeProfileTab, setActiveProfileTab] = React.useState<"lists" | "liked">("lists");

  // Helps render wishlist/favourite buckets without recomputing for each list.
  const entriesByList = React.useMemo(() => {
    return entries.reduce<Record<string, SavedEntry[]>>((acc, entry) => {
      acc[entry.listId] = acc[entry.listId] ? [...acc[entry.listId], entry] : [entry];
      return acc;
    }, {});
  }, [entries]);

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

  // Hide lists the viewer shouldn't see based on profile visibility + follow status.
  const visibleLists = React.useMemo(() => {
    return lists.filter((list) =>
      canViewList(list.visibility, { isSelf, isFollower: Boolean(isFollowingUser) })
    );
  }, [isFollowingUser, isSelf, lists]);

  const MAX_VISIBLE_LISTS = 6;
  const sortedLists = React.useMemo(() => {
    return [...visibleLists].sort((a, b) => {
      const aRecency = listStats.recency.get(a.id) ?? 0;
      const bRecency = listStats.recency.get(b.id) ?? 0;
      if (aRecency === bRecency) return a.name.localeCompare(b.name);
      return bRecency - aRecency;
    });
  }, [listStats.recency, visibleLists]);
  const galleryLists = React.useMemo(
    () => sortedLists.slice(0, MAX_VISIBLE_LISTS),
    [sortedLists],
  );

  const groupedLists = React.useMemo<GroupedList[]>(() => {
    return galleryLists.map((definition) => {
      const related = entriesByList[definition.id] ?? [];
      return {
        definition,
        wishlist: related.filter((entry) => entry.bucket === "wishlist"),
        favourite: related.filter((entry) => entry.bucket === "favourite"),
      };
    });
  }, [entriesByList, galleryLists]);

  const [selectedListId, setSelectedListId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!galleryLists.length) {
      setSelectedListId(null);
      return;
    }
    if (!selectedListId || !galleryLists.some((list) => list.id === selectedListId)) {
      setSelectedListId(galleryLists[0].id);
    }
  }, [galleryLists, selectedListId]);


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
  React.useEffect(() => {
    if (!canShowLikedLists && activeProfileTab === "liked") {
      setActiveProfileTab("lists");
    }
  }, [activeProfileTab, canShowLikedLists]);

  const wishlistCount = entries.filter((entry) => entry.bucket === "wishlist").length;
  const favouriteCount = entries.filter((entry) => entry.bucket === "favourite").length;
  const totalSavedCount = wishlistCount + favouriteCount;
  const profileDisplayName = profile?.displayName ?? profile?.username ?? "Unknown user";
  const profileUsername = profile?.username ?? null;
  const profileBio = profile?.bio ?? null;
  const profilePhoto = profile?.photoURL ?? null;

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
      setActivePinEntry(null);
      setMapModalVisible(false);
      requestMapFocus(entry);
      router.push("/(tabs)/map");
    },
    [requestMapFocus, router],
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

  React.useEffect(() => {
    if (!profile || !selectedGroup || !user) {
      setLikedByCount(null);
      return;
    }
    const directCount = selectedGroup.definition.savesCount;
    if (typeof directCount === "number") {
      setLikedByCount(directCount);
      return;
    }
    let active = true;
    const loadCount = async () => {
      try {
        const countSnap = await getCountFromServer(
          query(
            collection(firestore, "listLikes"),
            where("ownerId", "==", profile.id),
            where("listId", "==", selectedGroup.definition.id),
          ),
        );
        if (!active) return;
        setLikedByCount(countSnap.data().count ?? 0);
      } catch (err) {
        if (!active) return;
        console.warn("Failed to load liked-by count", err);
        setLikedByCount(0);
      }
    };
    void loadCount();
    return () => {
      active = false;
    };
  }, [profile, selectedGroup]);
  React.useEffect(() => {
    if (!likedListsFromProfile.length) {
      setExpandedLikedId(null);
      return;
    }
    setExpandedLikedId((current) =>
      current && likedListsFromProfile.some((item) => item.listId === current) ? current : null,
    );
  }, [likedListsFromProfile]);

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

  React.useEffect(() => {
    if (!resolvedUid || !user) {
      return;
    }
    let active = true;
    const loadCounts = async () => {
      try {
        const followersCountSnap = await getCountFromServer(
          query(collection(firestore, USER_FOLLOWS_COLLECTION), where("followeeId", "==", resolvedUid)),
        );
        const followingCountSnap = await getCountFromServer(
          query(collection(firestore, USER_FOLLOWS_COLLECTION), where("followerId", "==", resolvedUid)),
        );
        if (!active) return;
        setFollowersCount(followersCountSnap.data().count ?? 0);
        setFollowingCount(followingCountSnap.data().count ?? 0);
      } catch (err) {
        if (!active) return;
        console.warn("Failed to load follow counts", err);
      }
    };
    void loadCounts();
    return () => {
      active = false;
    };
  }, [resolvedUid, user]);

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
        setFollowersCount((count) => Math.max(0, count - 1));
      } else {
        await followUser(user.uid, resolvedUid);
        setIsFollowingUser(true);
        setFollowersCount((count) => count + 1);
      }
    } catch (err) {
      console.error("Failed to update follow status", err);
      setFollowError(err instanceof Error ? err.message : "Unable to update follow status.");
    } finally {
      setFollowBusy(false);
    }
  }, [canFollow, followBusy, followStatusLoading, isFollowingUser, resolvedUid, user]);

  const loadFollowList = React.useCallback(
    async (mode: "followers" | "following") => {
      if (!resolvedUid || !user) return;
      setFollowLoading(true);
      try {
        const followQuery =
          mode === "followers"
            ? query(collection(firestore, USER_FOLLOWS_COLLECTION), where("followeeId", "==", resolvedUid))
            : query(collection(firestore, USER_FOLLOWS_COLLECTION), where("followerId", "==", resolvedUid));
        const snap = await getDocs(followQuery);
        const ids =
          mode === "followers"
            ? snap.docs
                .map((docSnap) => (docSnap.data() as { followerId?: string }).followerId)
                .filter((id): id is string => Boolean(id))
            : snap.docs
                .map((docSnap) => (docSnap.data() as { followeeId?: string }).followeeId)
                .filter((id): id is string => Boolean(id));

        const profiles = await Promise.all(
          ids.map(async (id) => {
            const profileSnap = await getDoc(doc(firestore, USERS_COLLECTION, id));
            const data = profileSnap.exists()
              ? (profileSnap.data() as { displayName?: string | null; username?: string | null; photoURL?: string | null })
              : {};
            return {
              id,
              displayName: data.displayName ?? null,
              username: data.username ?? null,
              photoURL: data.photoURL ?? null,
            } as ProfileLite;
          })
        );
        const visibleProfiles = profiles.filter((candidate) => !blockedUserIds.includes(candidate.id));

        if (mode === "followers") {
          setFollowersList(visibleProfiles);
          setFollowersCount(visibleProfiles.length);
        } else {
          setFollowingList(visibleProfiles);
          setFollowingCount(visibleProfiles.length);
        }
      } catch (error) {
        console.warn("Failed to load follow list", error);
        if (mode === "followers") {
          setFollowersList([]);
        } else {
          setFollowingList([]);
        }
      } finally {
        setFollowLoading(false);
      }
    },
    [blockedUserIds, resolvedUid, user]
  );

  const resetReportState = React.useCallback(() => {
    setReportReason("");
    setReportSubmitting(false);
  }, []);

  const handleSubmitUserReport = React.useCallback(async () => {
    if (!user?.uid || !resolvedUid || !profile) {
      Alert.alert("Sign in required", "Please sign in to report users.");
      return;
    }

    setReportSubmitting(true);
    try {
      await createReport({
        reporterId: user.uid,
        targetType: "user",
        targetId: resolvedUid,
        targetUserId: resolvedUid,
        label: profile.displayName ?? profile.username ?? "User",
        reason: reportReason,
      });
      setReportUserVisible(false);
      resetReportState();
      Alert.alert("Report submitted", "Thanks. We’ll review it manually.");
    } catch (err) {
      console.error("Failed to submit user report", err);
      Alert.alert("Unable to report", "Please try again.");
      setReportSubmitting(false);
    }
  }, [profile, reportReason, resetReportState, resolvedUid, user?.uid]);

  const handleSubmitListReport = React.useCallback(async () => {
    if (!user?.uid || !resolvedUid || !selectedGroup) {
      Alert.alert("Sign in required", "Please sign in to report lists.");
      return;
    }

    setReportSubmitting(true);
    try {
      await createReport({
        reporterId: user.uid,
        targetType: "list",
        targetId: `${resolvedUid}:${selectedGroup.definition.id}`,
        targetUserId: resolvedUid,
        listId: selectedGroup.definition.id,
        label: selectedGroup.definition.name,
        reason: reportReason,
      });
      setReportListVisible(false);
      resetReportState();
      Alert.alert("Report submitted", "Thanks. We’ll review it manually.");
    } catch (err) {
      console.error("Failed to submit list report", err);
      Alert.alert("Unable to report", "Please try again.");
      setReportSubmitting(false);
    }
  }, [reportReason, resetReportState, resolvedUid, selectedGroup, user?.uid]);

  const handleToggleBlock = React.useCallback(async () => {
    if (!user?.uid || !resolvedUid || isSelf) {
      Alert.alert("Sign in required", "Please sign in to manage blocks.");
      return;
    }
    if (blockBusy) return;

    setBlockBusy(true);
    try {
      if (isBlocked) {
        await unblock(resolvedUid);
      } else {
        await block(resolvedUid);
        setProfileMenuOpen(false);
        router.back();
      }
    } catch (err) {
      console.error("Failed to update block state", err);
      Alert.alert("Unable to update block", "Please try again.");
    } finally {
      setBlockBusy(false);
    }
  }, [block, blockBusy, isBlocked, isSelf, resolvedUid, router, unblock, user?.uid]);

  React.useEffect(() => {
    if (!followModalOpen) return;
    void loadFollowList(followModalTab);
  }, [followModalOpen, followModalTab, loadFollowList]);

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

  if (isBlocked) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>This user is blocked.</Text>
      </View>
    );
  }

  const scrollTopPadding = Math.max(insets.top, 16) + (feedbackMessage ? 40 : 0);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
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
        style={{ flex: 1 }}
        bounces={false}
        alwaysBounceVertical={false}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingTop: 24 },
        ]}
      >
        <View style={styles.profileHeader}>
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
                  <Text style={styles.metricValue}>{totalSavedCount}</Text>
                  <Text style={styles.metricLabel}>Places</Text>
                </View>
                <Pressable
                  style={styles.metricItem}
                  onPress={() => {
                    if (!user) {
                      Alert.alert("Sign in to view followers", "Please sign in to view follower lists.");
                      return;
                    }
                    setFollowModalTab("followers");
                    setFollowModalOpen(true);
                  }}
                >
                  <Text style={styles.metricValue}>{followersCount}</Text>
                  <Text style={styles.metricLabel}>Followers</Text>
                </Pressable>
                <Pressable
                  style={styles.metricItem}
                  onPress={() => {
                    if (!user) {
                      Alert.alert("Sign in to view following", "Please sign in to view following lists.");
                      return;
                    }
                    setFollowModalTab("following");
                    setFollowModalOpen(true);
                  }}
                >
                  <Text style={styles.metricValue}>{followingCount}</Text>
                  <Text style={styles.metricLabel}>Following</Text>
                </Pressable>
              </View>
            </View>
          </View>
          <View style={styles.profileDetails}>
            <Text style={styles.profileName}>{profileDisplayName}</Text>
            {profileBio ? <Text style={styles.profileBio}>{profileBio}</Text> : null}
            <View style={styles.profileActions}>
              {canFollow ? (
                <Pressable
                  style={[
                    styles.editAccountButton,
                    (followBusy || followStatusLoading) && styles.editAccountButtonDisabled,
                  ]}
                  disabled={followBusy || followStatusLoading}
                  onPress={handleFollowToggle}
                >
                  <Text
                    style={styles.editAccountLabel}
                  >
                    {followStatusLoading ? "..." : isFollowingUser ? "Following" : "Follow"}
                  </Text>
                </Pressable>
              ) : null}
              {!isSelf ? (
                <Pressable
                  style={styles.profileMenuTrigger}
                  onPress={() => setProfileMenuOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="More actions"
                >
                  <FontAwesome name="ellipsis-h" size={16} color="#0f172a" />
                </Pressable>
              ) : null}
            </View>
            {followError ? <Text style={styles.followError}>{followError}</Text> : null}
          </View>
        </View>

        <View style={styles.profileTabs}>
          <Pressable
            onPress={() => setActiveProfileTab("lists")}
            style={[
              styles.profileTab,
              activeProfileTab === "lists" && styles.profileTabActive,
            ]}
          >
            <Text
              style={[
                styles.profileTabText,
                activeProfileTab === "lists" && styles.profileTabTextActive,
              ]}
            >
              Lists
            </Text>
          </Pressable>
          {canShowLikedLists ? (
            <Pressable
              onPress={() => setActiveProfileTab("liked")}
              style={[
                styles.profileTab,
                activeProfileTab === "liked" && styles.profileTabActive,
              ]}
            >
              <Text
                style={[
                  styles.profileTabText,
                  activeProfileTab === "liked" && styles.profileTabTextActive,
                ]}
              >
                Liked
              </Text>
            </Pressable>
          ) : null}
        </View>

        {activeProfileTab === "lists" ? (
          <>
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
                  ListFooterComponent={
                    sortedLists.length > MAX_VISIBLE_LISTS
                      ? () => (
                          <View style={styles.galleryFooterRow}>
                            <Pressable
                              style={styles.galleryAllChip}
                              onPress={() => {
                                setListSearch("");
                                setListPickerOpen(true);
                              }}
                            >
                              <Text style={styles.galleryAllChipLabel}>All</Text>
                              <View style={styles.galleryAllChipCount}>
                                <Text style={styles.galleryAllChipCountText}>{sortedLists.length}</Text>
                              </View>
                            </Pressable>
                          </View>
                        )
                      : undefined
                  }
                  ListFooterComponentStyle={styles.galleryFooter}
                  renderItem={({ item }) => {
                    const total = item.wishlist.length + item.favourite.length;
                    const isSelected = item.definition.id === selectedListId;
                    return (
                      <Pressable
                        style={[styles.galleryCard, isSelected && styles.galleryCardSelected]}
                        onPress={() => setSelectedListId(item.definition.id)}
                      >
                        <View style={styles.listChipRow}>
                          <Text style={styles.listChipTitle} numberOfLines={1} ellipsizeMode="tail">
                            {item.definition.name}
                          </Text>
                          <View style={styles.listChipCount}>
                            <Text style={styles.listChipCountText}>{total}</Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  }}
                />

                {selectedGroup ? (
                  <View style={styles.detailSection}>
                    <View style={styles.detailHeader}>
                      <View style={styles.detailHeaderText}>
                        <Text style={styles.detailTitle}>{selectedGroup.definition.name}</Text>
                        {selectedGroup.definition.description ? (
                          <Text style={styles.listDescription}>
                            {selectedGroup.definition.description}
                          </Text>
                        ) : null}
                        <Text style={styles.listMeta}>
                          {totalItems} {totalItems === 1 ? "place saved" : "places saved"}
                        </Text>
                      </View>
                      {profile && (
                        <View style={styles.detailActions}>
                          <Pressable
                            style={[
                              styles.detailStarButton,
                              isListLiked(profile.id, selectedGroup.definition.id) &&
                                styles.detailStarButtonActive,
                            ]}
                            onPress={() => handleToggleListLike(selectedGroup.definition)}
                            hitSlop={12}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isListLiked(profile.id, selectedGroup.definition.id)
                                ? "Unstar list"
                                : "Star list"
                            }
                          >
                            <FontAwesome
                              name={
                                isListLiked(profile.id, selectedGroup.definition.id) ? "star" : "star-o"
                              }
                              size={18}
                              color={
                                isListLiked(profile.id, selectedGroup.definition.id) ? "#f59e0b" : "#0f172a"
                              }
                            />
                          </Pressable>
                          {!isSelf ? (
                            <Pressable
                              style={styles.detailOverflowButton}
                              onPress={() => setListMenuOpen(true)}
                            >
                              <FontAwesome name="ellipsis-h" size={14} color="#0f172a" />
                            </Pressable>
                          ) : null}
                        </View>
                      )}
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
                            onPress={() => handleMarkerPress(entry)}
                            anchor={{ x: 0.5, y: 0.5 }}
                            tracksViewChanges={false}
                          >
                            <SavedPlaceMarkerIcon bucket={entry.bucket} source="friend" />
                          </Marker>
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
                            accessibilityLabel={`Open ${entry.pin.label} on the map`}
                          >
                            <View style={styles.bucketItemRow}>
                              <View style={styles.bucketItemIcon}>
                                <FontAwesome name="map-marker" size={12} color="#94a3b8" />
                              </View>
                              <Text style={styles.bucketItem}>{entry.pin.label}</Text>
                              <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
                            </View>
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
                            accessibilityLabel={`Open ${entry.pin.label} on the map`}
                          >
                            <View style={styles.bucketItemRow}>
                              <View style={styles.bucketItemIcon}>
                                <FontAwesome name="map-marker" size={12} color="#94a3b8" />
                              </View>
                              <Text style={styles.bucketItem}>{entry.pin.label}</Text>
                              <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
                            </View>
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
          </>
        ) : null}

        {activeProfileTab === "liked" && canShowLikedLists ? (
          <View style={styles.likedSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Liked Lists</Text>
            </View>
            {likedListsFromProfile.length ? (
              likedListsFromProfile.map((item) => {
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
                              anchor={{ x: 0.5, y: 0.5 }}
                              tracksViewChanges={false}
                            >
                              <SavedPlaceMarkerIcon bucket={entry.bucket} source="liked" />
                            </Marker>
                          ))}
                        </MapView>
                        <View style={styles.likedBucketSection}>
                          <Text style={styles.bucketTitle}>Wishlist</Text>
                          {item.wishlist.length ? (
                            item.wishlist.map((entry) => (
                              <Pressable
                                key={`liked-wish-${entry.savedAt}`}
                                onPress={() => handleEntryFocus(entry)}
                                style={styles.bucketItemButton}
                                accessibilityRole="button"
                                accessibilityLabel={`Open ${entry.pin.label} on the map`}
                              >
                                <View style={styles.bucketItemRow}>
                                  <View style={styles.bucketItemIcon}>
                                    <FontAwesome name="map-marker" size={12} color="#94a3b8" />
                                  </View>
                                  <Text style={styles.bucketItem}>{entry.pin.label}</Text>
                                  <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
                                </View>
                              </Pressable>
                            ))
                          ) : (
                            <Text style={styles.emptyState}>No wishlist saves yet.</Text>
                          )}
                        </View>
                        <View style={styles.likedBucketSection}>
                          <Text style={styles.bucketTitle}>Favourite</Text>
                          {item.favourite.length ? (
                            item.favourite.map((entry) => (
                              <Pressable
                                key={`liked-fav-${entry.savedAt}`}
                                onPress={() => handleEntryFocus(entry)}
                                style={styles.bucketItemButton}
                                accessibilityRole="button"
                                accessibilityLabel={`Open ${entry.pin.label} on the map`}
                              >
                                <View style={styles.bucketItemRow}>
                                  <View style={styles.bucketItemIcon}>
                                    <FontAwesome name="map-marker" size={12} color="#94a3b8" />
                                  </View>
                                  <Text style={styles.bucketItem}>{entry.pin.label}</Text>
                                  <FontAwesome name="chevron-right" size={12} color="#94a3b8" />
                                </View>
                              </Pressable>
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
              <Text style={styles.emptyState}>No liked lists yet.</Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      <PinDetailSheet
        entry={activePinEntry}
        onClose={closeActivePinSheet}
        bottomInset={insets.bottom}
        onReport={
          !isSelf && user?.uid
            ? async (entry, reason) => {
                await createReport({
                  reporterId: user.uid,
                  targetType: "place",
                  targetId: entry.pin.placeId ?? `${entry.pin.lat}:${entry.pin.lng}:${entry.pin.label}`,
                  targetUserId: resolvedUid ?? null,
                  listId: entry.listId,
                  placeId: entry.pin.placeId ?? null,
                  label: entry.pin.label,
                  reason,
                });
              }
            : undefined
        }
      />

      <ReportModal
        visible={reportUserVisible}
        title="Report user"
        reason={reportReason}
        loading={reportSubmitting}
        onChangeReason={setReportReason}
        onClose={() => {
          setReportUserVisible(false);
          resetReportState();
        }}
        onSubmit={handleSubmitUserReport}
      />

      <Modal
        visible={profileMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileMenuOpen(false)}
      >
        <Pressable style={styles.actionSheetOverlay} onPress={() => setProfileMenuOpen(false)}>
          <View style={styles.actionSheetCard}>
            <Pressable
              style={styles.actionSheetRow}
              onPress={() => {
                setProfileMenuOpen(false);
                setReportReason("");
                setReportUserVisible(true);
              }}
            >
              <Text style={styles.actionSheetText}>Report User</Text>
            </Pressable>
            <Pressable style={styles.actionSheetRow} onPress={handleToggleBlock} disabled={blockBusy}>
              <Text style={[styles.actionSheetText, styles.actionSheetDanger]}>{blockBusy ? "Blocking..." : "Block User"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={listMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setListMenuOpen(false)}
      >
        <Pressable style={styles.actionSheetOverlay} onPress={() => setListMenuOpen(false)}>
          <View style={styles.actionSheetCard}>
            <Pressable
              style={styles.actionSheetRow}
              onPress={() => {
                setListMenuOpen(false);
                setReportReason("");
                setReportListVisible(true);
              }}
            >
              <Text style={styles.actionSheetText}>Report List</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <ReportModal
        visible={reportListVisible}
        title="Report list"
        reason={reportReason}
        loading={reportSubmitting}
        onChangeReason={setReportReason}
        onClose={() => {
          setReportListVisible(false);
          resetReportState();
        }}
        onSubmit={handleSubmitListReport}
      />

      <Modal
        visible={followModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setFollowModalOpen(false)}
      >
        <View style={styles.followModalOverlay}>
          <View style={styles.followModalCard}>
            <View style={styles.followModalHeader}>
              <Text style={styles.followModalTitle}>Connections</Text>
              <Pressable onPress={() => setFollowModalOpen(false)} hitSlop={8}>
                <Text style={styles.followModalClose}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.followTabs}>
              <Pressable
                onPress={() => setFollowModalTab("followers")}
                style={[
                  styles.followTab,
                  followModalTab === "followers" && styles.followTabActive,
                ]}
              >
                <Text
                  style={[
                    styles.followTabText,
                    followModalTab === "followers" && styles.followTabTextActive,
                  ]}
                >
                  Followers
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFollowModalTab("following")}
                style={[
                  styles.followTab,
                  followModalTab === "following" && styles.followTabActive,
                ]}
              >
                <Text
                  style={[
                    styles.followTabText,
                    followModalTab === "following" && styles.followTabTextActive,
                  ]}
                >
                  Following
                </Text>
              </Pressable>
            </View>
            {followLoading ? (
              <View style={styles.followLoading}>
                <ActivityIndicator size="small" color="#0f172a" />
              </View>
            ) : (
              <FlatList
                data={followModalTab === "followers" ? followersList : followingList}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.followList}
                renderItem={({ item }) => {
                  const label = item.displayName ?? (item.username ? `@${item.username}` : "Unknown");
                  const sub = item.username && item.displayName ? `@${item.username}` : null;
                  return (
                    <View style={styles.followRow}>
                      <RemoteAvatar
                        uri={item.photoURL}
                        label={label}
                        size={36}
                        backgroundColor="#f1f5f9"
                        textColor="#64748b"
                        fontSize={14}
                      />
                      <View style={styles.followText}>
                        <Text style={styles.followName} numberOfLines={1}>
                          {label}
                        </Text>
                        {sub ? (
                          <Text style={styles.followSub} numberOfLines={1}>
                            {sub}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.followEmpty}>
                    <Text style={styles.followEmptyText}>No users yet.</Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>

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
                      onPress={() => handleMarkerPress(entry)}
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                    >
                      <SavedPlaceMarkerIcon bucket={entry.bucket} source="friend" />
                    </Marker>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
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
  profileHeader: {
    gap: 16,
  },
  profileInfoRow: {
    flexDirection: "row",
    alignItems: "center",
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
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarInitial: {
    fontSize: 26,
    fontWeight: "700",
    color: "#475569",
  },
  profileMetricsBlock: {
    flex: 1,
  },
  profileUsername: {
    fontSize: 14,
    color: "#94a3b8",
    marginBottom: 8,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 14,
  },
  metricItem: {
    gap: 4,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  metricLabel: {
    fontSize: 11,
    color: "#64748b",
  },
  profileDetails: {
    gap: 8,
  },
  profileName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0f172a",
  },
  profileBio: {
    fontSize: 14,
    color: "#0f172a",
    marginTop: 6,
    lineHeight: 20,
  },
  profileActions: {
    flexDirection: "row",
    marginTop: 4,
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },
  profileMenuTrigger: {
    borderRadius: 999,
    width: 38,
    height: 38,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  profileTabs: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
    backgroundColor: "#e2e8f0",
    borderRadius: 16,
    padding: 4,
  },
  profileTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: "center",
  },
  profileTabActive: {
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  profileTabText: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  profileTabTextActive: {
    color: "#0f172a",
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
    gap: 10,
    paddingVertical: 6,
  },
  galleryFooter: {
    paddingRight: 12,
  },
  galleryFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  galleryAllChip: {
    height: 50,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderStyle: "dashed",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  galleryAllChipLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
  },
  galleryAllChipCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryAllChipCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#4338ca",
  },
  galleryCard: {
    width: 160,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    minHeight: 50,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  galleryCardSelected: {
    borderColor: "#c7d2fe",
    backgroundColor: "#f8faff",
    borderBottomWidth: 2,
    borderBottomColor: "#818cf8",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  listChipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  listChipTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
  },
  listChipCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  listChipCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#4338ca",
  },
  listPickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.25)",
    justifyContent: "flex-end",
  },
  listPickerSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 12,
    maxHeight: "80%",
  },
  listPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listPickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  listPickerClose: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  listPickerSearchWrap: {
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listPickerSearchInput: {
    fontSize: 14,
    color: "#0f172a",
  },
  listPickerList: {
    paddingBottom: 8,
    gap: 8,
  },
  listPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
  },
  listPickerRowActive: {
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff",
  },
  listPickerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  listPickerText: {
    flex: 1,
    gap: 2,
  },
  listPickerName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  listPickerMetaText: {
    fontSize: 11,
    color: "#64748b",
  },
  listPickerEmpty: {
    paddingVertical: 20,
    alignItems: "center",
  },
  listPickerEmptyText: {
    fontSize: 13,
    color: "#94a3b8",
  },
  followModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  followModalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: "70%",
    width: "100%",
  },
  followModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  followModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  followModalClose: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  followTabs: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#e2e8f0",
    borderRadius: 16,
    padding: 3,
    marginBottom: 12,
  },
  followTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: "center",
  },
  followTabActive: {
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  followTabText: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  followTabTextActive: {
    color: "#0f172a",
  },
  followLoading: {
    paddingVertical: 20,
    alignItems: "center",
  },
  followList: {
    paddingBottom: 24,
    gap: 10,
  },
  followRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  followText: {
    flex: 1,
    gap: 2,
  },
  followName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  followSub: {
    fontSize: 12,
    color: "#64748b",
  },
  followEmpty: {
    paddingVertical: 24,
    alignItems: "center",
  },
  followEmptyText: {
    fontSize: 12,
    color: "#94a3b8",
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
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  detailHeaderText: {
    flex: 1,
    gap: 6,
  },
  detailActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detailStarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  detailOverflowButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  detailStarButtonActive: {
    backgroundColor: "rgba(250,204,21,0.18)",
    borderColor: "#fbbf24",
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
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  bucketItemButton: {
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  bucketItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  bucketItemIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  bucketItem: {
    fontSize: 15,
    color: "#1e293b",
    flex: 1,
  },
  likedSection: {
    marginTop: 24,
    gap: 12,
  },
  likedAccordionCard: {
    borderRadius: 16,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  likedAccordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  likedAccordionBody: {
    marginTop: 10,
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  likedMap: {
    height: 150,
    borderRadius: 12,
  },
  likedBucketSection: {
    gap: 4,
  },
  likedCardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  likedCardOwner: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
  },
  likedCardDescription: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 8,
  },
  editAccountButton: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#0f172a",
  },
  editAccountButtonDisabled: {
    opacity: 0.6,
  },
  editAccountLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
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
  actionSheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.28)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  actionSheetCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    overflow: "hidden",
  },
  actionSheetRow: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  actionSheetText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  actionSheetDanger: {
    color: "#b91c1c",
  },
});
