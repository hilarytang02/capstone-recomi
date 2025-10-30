import React from "react";
import {
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "../../components/MapView";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Camera } from "react-native-maps";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useIsFocused } from "@react-navigation/native";
import { useSavedLists, type SavedEntry } from "../../shared/context/savedLists";

const WORLD: Region = {
  latitude: 20,
  longitude: 0,
  latitudeDelta: 80,     // big deltas = zoomed out
  longitudeDelta: 180,
};
const STREET_DELTA = 0.0025; // tighter zoom for block-level view
const SHEET_LAT_OFFSET_FACTOR = 0.38; // push map center upward when sheet is visible

type SheetState = "hidden" | "collapsed" | "half" | "expanded";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHTS: Record<SheetState, number> = {
  hidden: 0,
  collapsed: Math.max(SCREEN_HEIGHT * 0.12, 110),
  half: SCREEN_HEIGHT * 0.5,
  expanded: Math.min(SCREEN_HEIGHT * 0.82, SCREEN_HEIGHT - 96),
};

const OFFSET_BY_SHEET: Record<SheetState, number> = {
  hidden: 0,
  collapsed: 0,
  half: 0.18,
  expanded: SHEET_LAT_OFFSET_FACTOR,
};

const makeRegion = (
  latitude: number,
  longitude: number,
  delta = STREET_DELTA,
  offsetFactor = 0
): Region => ({
  latitude: latitude - delta * offsetFactor,
  longitude,
  latitudeDelta: delta,
  longitudeDelta: delta,
});

type PinData = {
  lat: number;
  lng: number;
  label: string;
};

type ListBucket = "none" | "wishlist" | "favourite";

const buildLabel = (place: any, fallback: string) => {
  if (!place) return fallback;
  const primary =
    place.name ??
    place.street ??
    place.streetName ??
    place.address ??
    place.subThoroughfare ??
    place.district;
  const secondary = place.city ?? place.subregion ?? place.region ?? place.postalCode;
  const label = [primary, secondary].filter(Boolean).join(", ");
  return label || fallback;
};

const coordsMatch = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const mapRef = React.useRef<MapView | null>(null);
  const [region, setRegion] = React.useState<Region>(WORLD);
  const [locPerm, setLocPerm] = React.useState<"granted" | "denied" | "undetermined">("undetermined");
  const [query, setQuery] = React.useState("");
  const [pin, setPin] = React.useState<PinData | null>(null);
  const [userCoords, setUserCoords] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [sheetState, setSheetState] = React.useState<SheetState>("hidden");
  const [listModalVisible, setListModalVisible] = React.useState(false);
  const { addEntry, entries, removeEntry, lists, addList } = useSavedLists();
  const [pinSaveStatus, setPinSaveStatus] = React.useState<"wishlist" | "favourite" | null>(null);
  const [heading, setHeading] = React.useState(0);
  const [cameraInfo, setCameraInfo] = React.useState<Camera | null>(null);
  const [bulkMovePrompt, setBulkMovePrompt] = React.useState<{
    primaryListId: string;
    primaryListName: string;
    wishlistListIds: string[];
    locationLabel: string;
  } | null>(null);
  const [initialListStates, setInitialListStates] = React.useState<Record<string, ListBucket>>({});
  const [pendingListStates, setPendingListStates] = React.useState<Record<string, ListBucket>>({});
  const [newListModalVisible, setNewListModalVisible] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  const [newListError, setNewListError] = React.useState<string | null>(null);
  const reopenListModalRef = React.useRef(false);

  const locationLabel = pin?.label ?? "this place";
  const bulkMoveListNames = React.useMemo(() => {
    if (!bulkMovePrompt) return [];
    return bulkMovePrompt.wishlistListIds
      .map((id) => lists.find((list) => list.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  }, [bulkMovePrompt, lists]);
  const bulkMoveDisplayNames = React.useMemo(
    () => bulkMoveListNames.slice(0, 3),
    [bulkMoveListNames]
  );
  const bulkMoveShowEtc = bulkMoveListNames.length > 3;

  React.useEffect(() => {
    if (listModalVisible) {
      setPendingListStates(initialListStates);
      setBulkMovePrompt(null);
    }
  }, [initialListStates, listModalVisible]);

  React.useEffect(() => {
    if (!pin) {
      setPinSaveStatus(null);
      setInitialListStates({});
      setPendingListStates({});
      return;
    }

    const matches = entries.filter(
      (entry) =>
        Math.abs(entry.pin.lat - pin.lat) < 1e-8 &&
        Math.abs(entry.pin.lng - pin.lng) < 1e-8
    );

    const nextInitial: Record<string, ListBucket> = {};
    lists.forEach((list) => {
      const match = matches.find((entry) => entry.listId === list.id);
      nextInitial[list.id] = match?.bucket ?? "none";
    });
    setInitialListStates(nextInitial);
    setPendingListStates(nextInitial);

    if (matches.some((entry) => entry.bucket === "favourite")) {
      setPinSaveStatus("favourite");
    } else if (matches.some((entry) => entry.bucket === "wishlist")) {
      setPinSaveStatus("wishlist");
    } else {
      setPinSaveStatus(null);
    }
  }, [entries, pin, lists]);

  React.useEffect(() => {
    // Prime local state without prompting; fetchUserLocation will handle requests.
    Location.getForegroundPermissionsAsync().then(({ status }) => setLocPerm(status));
  }, []);

  const animateTo = React.useCallback(
    (r: Region, ms = 800) => mapRef.current?.animateToRegion(r, ms),
    []
  );

  const focusOn = React.useCallback(
    (
      latitude: number,
      longitude: number,
      opts?: { delta?: number; targetSheet?: SheetState; animateMs?: number }
    ) => {
      const delta = opts?.delta ?? STREET_DELTA;
      const targetSheet = opts?.targetSheet ?? sheetState;
      const offsetFactor = OFFSET_BY_SHEET[targetSheet];
      const nextRegion = makeRegion(latitude, longitude, delta, offsetFactor);
      setRegion(nextRegion);
      animateTo(nextRegion, opts?.animateMs);
      setHeading(0);
      return nextRegion;
    },
    [animateTo, sheetState]
  );

  const fetchUserLocation = React.useCallback(
    async (animate = true) => {
      try {
        let status = locPerm;
        if (status !== "granted") {
          const permission = await Location.requestForegroundPermissionsAsync();
          status = permission.status;
          setLocPerm(status);
          if (status !== "granted") return null;
        }

        const { coords } = await Location.getCurrentPositionAsync({});
        const nextRegion = focusOn(coords.latitude, coords.longitude, {
          targetSheet: sheetState,
          animateMs: animate ? 800 : 0,
        });
        setUserCoords({ latitude: coords.latitude, longitude: coords.longitude });
        return nextRegion;
      } catch (err) {
        console.warn("Location lookup failed:", err);
        return null;
      }
    },
    [focusOn, locPerm, sheetState]
  );

  const goToMyLocation = React.useCallback(() => {
    setPin(null);
    setSheetState("hidden");
    setPinSaveStatus(null);
    setListModalVisible(false);
    setBulkMovePrompt(null);
    void fetchUserLocation(true);
  }, [fetchUserLocation]);

  React.useEffect(() => {
    void fetchUserLocation(true);
    // We intentionally ignore dependency warnings so closing the sheet does not re-trigger centering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (raw?: string) => {
    const trimmed = (raw ?? query).trim();
    if (!trimmed) {
      setPin(null);
      setSheetState("hidden");
      setPinSaveStatus(null);
      setListModalVisible(false);
      setBulkMovePrompt(null);
      return;
    }

    try {
      const results = await Location.geocodeAsync(trimmed);
      const match = results[0];
      if (!match) return;

      const { latitude, longitude } = match;
      const label = buildLabel(match, trimmed);
      setPin({ lat: latitude, lng: longitude, label });
      setSheetState("half");
      focusOn(latitude, longitude, { targetSheet: "half" });
      setPinSaveStatus(null);
      setBulkMovePrompt(null);
    } catch (err) {
      console.warn("Geocoding failed:", err);
    }
  };

  const handleMapPress = ({ latitude, longitude }: { latitude: number; longitude: number }) => {
    const basePin: PinData = { lat: latitude, lng: longitude, label: "Dropped pin" };
    setPin(basePin);
    setQuery("");
    setSheetState("half");
    focusOn(latitude, longitude, { targetSheet: "half" });
    setPinSaveStatus(null);
    setBulkMovePrompt(null);

    void Location.reverseGeocodeAsync({ latitude, longitude })
      .then((results) => {
        const name = buildLabel(results?.[0], basePin.label);
        setPin((current) => {
          if (!current) return current;
          return coordsMatch(current, basePin) ? { ...current, label: name } : current;
        });
      })
      .catch((err) => {
        console.warn("Reverse geocode failed:", err);
      });
  };

  const handleCompassPress = React.useCallback(() => {
    if (!mapRef.current) return;

    if (cameraInfo && mapRef.current.animateCamera) {
      mapRef.current.animateCamera(
        {
          ...cameraInfo,
          heading: 0,
        },
        { duration: 300 }
      );
    } else if (mapRef.current.animateCamera) {
      const fallbackCamera: Camera = {
        center: {
          latitude: region.latitude,
          longitude: region.longitude,
        },
        heading: 0,
        pitch: 0,
        altitude: cameraInfo?.altitude ?? 1000,
        zoom: cameraInfo?.zoom,
      };
      mapRef.current.animateCamera(fallbackCamera, { duration: 300 });
    } else if (mapRef.current.animateToRegion) {
      mapRef.current.animateToRegion(
        makeRegion(region.latitude, region.longitude, region.latitudeDelta ?? STREET_DELTA),
        300
      );
    }

    setHeading(0);
    setCameraInfo((prev) => (prev ? { ...prev, heading: 0 } : prev));
  }, [cameraInfo, region.latitude, region.longitude]);

  React.useEffect(() => {
    if (!pin) {
      setSheetState("hidden");
      setPinSaveStatus(null);
      setBulkMovePrompt(null);
    }
  }, [pin]);

  React.useEffect(() => {
    if (!pin) return;
    if (sheetState === "hidden") return;
    focusOn(pin.lat, pin.lng, { targetSheet: sheetState, animateMs: 250 });
  }, [sheetState, pin, focusOn]);

  const sheetPanResponder = React.useMemo(() => {
    const order: SheetState[] = ["hidden", "collapsed", "half", "expanded"];

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 10,
      onPanResponderRelease: (_, gestureState) => {
        const currentIndex = order.indexOf(sheetState);
        if (gestureState.dy < -40) {
          const nextIndex = Math.min(currentIndex + 1, order.length - 1);
          const nextState = order[nextIndex];
          setSheetState(nextState === "hidden" ? "collapsed" : nextState);
        } else if (gestureState.dy > 40) {
          const nextIndex = Math.max(currentIndex - 1, 0);
          setSheetState(order[nextIndex]);
        }
      },
    });
  }, [sheetState]);

  const DOUBLE_TAP_DELAY = 250;
  const lastTapRef = React.useRef<Record<string, number>>({});

  const hasPendingChanges = React.useMemo(
    () =>
      lists.some((list) => (pendingListStates[list.id] ?? "none") !== (initialListStates[list.id] ?? "none")),
    [initialListStates, lists, pendingListStates]
  );

  const handleCancel = React.useCallback(() => {
    setPendingListStates(initialListStates);
    setBulkMovePrompt(null);
    lastTapRef.current = {};
    setListModalVisible(false);
  }, [initialListStates]);

  const openNewListModal = React.useCallback(() => {
    setNewListName("");
    setNewListError(null);
    reopenListModalRef.current = listModalVisible;
    setListModalVisible(false);
    setNewListModalVisible(true);
  }, [listModalVisible]);

  const closeNewListModal = React.useCallback(
    (options?: { reopenList?: boolean }) => {
      const reopen =
        options?.reopenList !== undefined ? options.reopenList : reopenListModalRef.current;
      setNewListModalVisible(false);
      setNewListError(null);
      setNewListName("");
      if (reopen && pin) {
        setListModalVisible(true);
      }
      reopenListModalRef.current = false;
    },
    [pin],
  );

  const handleCreateNewList = React.useCallback(() => {
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
      setInitialListStates((prev) => ({ ...prev, [created.id]: "none" }));
      setPendingListStates((prev) => ({
        ...prev,
        [created.id]: pin ? "wishlist" : "none",
      }));
      closeNewListModal({ reopenList: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create list.";
      setNewListError(message);
    }
  }, [addList, closeNewListModal, lists, newListName, pin]);

  const handleDone = React.useCallback(() => {
    if (!pin) {
      setListModalVisible(false);
      return;
    }

    const nextStates: Record<string, ListBucket> = { ...pendingListStates };
    let timestamp = Date.now();
    lists.forEach((list, index) => {
      const initialBucket = initialListStates[list.id] ?? "none";
      const pendingBucket = nextStates[list.id] ?? "none";
      if (initialBucket === pendingBucket) return;

      if (pendingBucket === "none") {
        removeEntry(list.id, pin);
      } else {
        const entry: SavedEntry = {
          listId: list.id,
          listName: list.name,
          bucket: pendingBucket,
          pin,
          savedAt: timestamp + index,
        };
        addEntry(entry);
      }
    });

    setInitialListStates(nextStates);
    setPendingListStates(nextStates);
    setListModalVisible(false);
    setBulkMovePrompt(null);
  }, [addEntry, initialListStates, lists, pendingListStates, pin, removeEntry]);

  const handleSingleTap = React.useCallback((listId: string) => {
    setPendingListStates((prev) => {
      const current = prev[listId] ?? "none";
      const next: ListBucket = current === "wishlist" ? "none" : "wishlist";
      return { ...prev, [listId]: next };
    });
  }, []);

  const maybePromptFavorites = React.useCallback(
    (listId: string, listName: string, states: Record<string, ListBucket>) => {
      const wishlistMatches = lists
        .filter((list) => list.id !== listId && (states[list.id] ?? "none") === "wishlist")
        .map((list) => list.id);
      if (!wishlistMatches.length) return;
      setBulkMovePrompt({
        primaryListId: listId,
        primaryListName: listName,
        wishlistListIds: wishlistMatches,
        locationLabel,
      });
    },
    [lists, locationLabel]
  );

  const handleDoubleTap = React.useCallback(
    (listId: string, listName: string) => {
      const nextStates = { ...pendingListStates, [listId]: "favourite" as ListBucket };
      setPendingListStates(nextStates);
      maybePromptFavorites(listId, listName, nextStates);
    },
    [maybePromptFavorites, pendingListStates]
  );

  const handleHeartPress = React.useCallback(
    (listId: string, listName: string) => {
      const now = Date.now();
      const lastTap = lastTapRef.current[listId] ?? 0;

      if (now - lastTap < DOUBLE_TAP_DELAY) {
        lastTapRef.current[listId] = 0;
        handleDoubleTap(listId, listName);
      } else {
        lastTapRef.current[listId] = now;
        handleSingleTap(listId);
      }
    },
    [handleDoubleTap, handleSingleTap]
  );

  const handleBulkMoveDecision = React.useCallback(
    (applyToAll: boolean) => {
      if (!bulkMovePrompt) {
        setBulkMovePrompt(null);
        return;
      }

      setPendingListStates((prev) => {
        const next = { ...prev, [bulkMovePrompt.primaryListId]: "favourite" as ListBucket };
        if (applyToAll) {
          bulkMovePrompt.wishlistListIds.forEach((id) => {
            next[id] = "favourite";
          });
        }
        return next;
      });

      setBulkMovePrompt(null);
    },
    [bulkMovePrompt]
  );

  React.useEffect(() => {
    if (sheetState === "collapsed" || sheetState === "hidden") {
      if (listModalVisible) {
        handleCancel();
      }
      setBulkMovePrompt(null);
    }
  }, [handleCancel, listModalVisible, sheetState]);

  React.useEffect(() => {
    if (isFocused) {
      return;
    }
    if (listModalVisible) {
      handleCancel();
    }
    if (newListModalVisible) {
      closeNewListModal({ reopenList: false });
    }
    if (bulkMovePrompt) {
      setBulkMovePrompt(null);
    }
  }, [
    bulkMovePrompt,
    closeNewListModal,
    handleCancel,
    isFocused,
    listModalVisible,
    newListModalVisible,
  ]);

  const showSearchBar = sheetState !== "expanded";
  const sheetHeight = SHEET_HEIGHTS[sheetState];
  const isSheetExpanded = sheetState === "expanded";
  const isSheetCollapsed = sheetState === "collapsed";
  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={userCoords ? makeRegion(userCoords.latitude, userCoords.longitude) : WORLD}
        region={region}
        onRegionChangeComplete={async (nextRegion) => {
          setRegion(nextRegion);
          try {
            const camera = await mapRef.current?.getCamera?.();
            if (camera) {
              setCameraInfo(camera);
              if (camera.heading != null) {
                setHeading(camera.heading);
              }
            }
          } catch {
            // ignore inability to fetch camera heading
          }
        }}
        onPress={({ nativeEvent }) => handleMapPress(nativeEvent.coordinate)}
        showsScale={false}
        showsCompass={false}
        showsUserLocation={locPerm === "granted"}
        toolbarEnabled={false}
        zoomEnabled
        rotateEnabled
        scrollEnabled
        pitchEnabled
      >
        {pin && <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} />}
      </MapView>

      {showSearchBar && (
        <TextInput
          placeholder="Search a place or address"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={({ nativeEvent }) => handleSubmit(nativeEvent.text)}
          style={[styles.searchBar, { top: insets.top + 16 }]}
          blurOnSubmit
          enablesReturnKeyAutomatically
          returnKeyType="search"
        />
      )}

      <View style={styles.recenter}>
        <CompassButton heading={heading} onPress={handleCompassPress} />
        <Pressable onPress={goToMyLocation} style={styles.recenterBtn}>
          <Text style={styles.recenterText}>My Location</Text>
        </Pressable>
      </View>

      {pin && sheetState !== "hidden" && (
        <View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              paddingTop: isSheetCollapsed ? 8 : 12,
              paddingBottom: isSheetCollapsed ? 16 : 24,
            },
          ]}
          {...sheetPanResponder.panHandlers}
        >
          <View style={styles.sheetHandle} />
          <View
            style={[
              styles.sheetHeader,
              isSheetCollapsed && styles.sheetHeaderCollapsed,
            ]}
          >
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {pin.label}
            </Text>
            {isSheetCollapsed ? (
              <Pressable
                onPress={() => {
                  setListModalVisible(true);
                }}
                style={[styles.heartButton, styles.heartButtonSmall]}
                accessibilityRole="button"
                accessibilityLabel="Save to list"
              >
                <View style={[styles.heartIconWrapper, styles.heartIconWrapperSmall]}>
                  <FontAwesome
                    name={pinSaveStatus ? "heart" : "heart-o"}
                    size={16}
                    color={pinSaveStatus ? "#ef4444" : "#0f172a"}
                  />
                  {pinSaveStatus === "favourite" && (
                    <Text style={[styles.heartSparkle, styles.heartSparkleSmall]}>✨</Text>
                  )}
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setSheetState("hidden")}
                style={styles.sheetClose}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </Pressable>
            )}
          </View>

          {!isSheetCollapsed && (
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => {
                  setListModalVisible(true);
                }}
                style={styles.heartButton}
                accessibilityRole="button"
                accessibilityLabel="Save to list"
              >
                <View style={styles.heartIconWrapper}>
                  <FontAwesome
                    name={pinSaveStatus ? "heart" : "heart-o"}
                    size={20}
                    color={pinSaveStatus ? "#ef4444" : "#0f172a"}
                  />
                  {pinSaveStatus === "favourite" && (
                    <Text style={styles.heartSparkle}>✨</Text>
                  )}
                </View>
              </Pressable>
            </View>
          )}

          {(sheetState === "half" || sheetState === "expanded") && (
            <View style={styles.sheetBody}>
              <Text style={styles.sheetMeta}>
                Lat {pin.lat.toFixed(5)} · Lng {pin.lng.toFixed(5)}
              </Text>
              <Text style={styles.sheetHint}>Future recommendation details will appear here.</Text>
            </View>
          )}
        </View>
      )}

      <Modal
        visible={listModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
      >
        <Pressable style={styles.modalBackdrop} onPress={handleCancel} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>
            Save{" "}
            <Text style={styles.modalTitleLocation} numberOfLines={1}>
              {locationLabel}
            </Text>{" "}
            to Your Lists
          </Text>
          <View style={styles.modalListWrapper}>
            <FlatList
              data={lists}
              keyExtractor={(item) => item.id}
              extraData={pendingListStates}
              contentContainerStyle={styles.modalList}
              ListEmptyComponent={() => (
                <View style={styles.modalEmptyState}>
                  <Text style={styles.modalEmptyTitle}>No lists yet</Text>
                  <Text style={styles.modalEmptySubtitle}>
                    Create one to start saving your places.
                  </Text>
                  <Pressable
                    onPress={openNewListModal}
                    style={styles.modalEmptyButton}
                    accessibilityRole="button"
                    accessibilityLabel="Create a new list"
                  >
                    <FontAwesome name="plus" size={16} color="#0f172a" />
                    <Text style={styles.modalEmptyButtonText}>New List</Text>
                  </Pressable>
                </View>
              )}
              renderItem={({ item }) => {
                const currentBucket = pendingListStates[item.id] ?? "none";
                return (
                  <View style={styles.modalListItem}>
                    <Text style={styles.modalListText}>{item.name}</Text>
                    <Pressable
                      style={styles.modalListHeartButton}
                      onPress={() => handleHeartPress(item.id, item.name)}
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle ${item.name}`}
                      hitSlop={12}
                    >
                      <View style={styles.modalListIconWrapper}>
                        {currentBucket === "favourite" ? (
                          <>
                            <FontAwesome name="heart" size={18} color="#ef4444" />
                            <Text style={styles.modalListIconSparkle}>✨</Text>
                          </>
                        ) : currentBucket === "wishlist" ? (
                          <FontAwesome name="heart" size={18} color="#ef4444" />
                        ) : (
                          <FontAwesome name="heart-o" size={18} color="#9ca3af" />
                        )}
                      </View>
                    </Pressable>
                  </View>
                );
              }}
            />
          </View>
          <View style={styles.modalFooter}>
            <View style={styles.modalFooterLeft}>
              <Pressable
                onPress={openNewListModal}
                style={styles.modalNewListButton}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Create a new list"
              >
                <FontAwesome name="plus" size={14} color="#0f172a" />
                <Text style={styles.modalNewListText}>List</Text>
              </Pressable>
              <Pressable onPress={handleCancel} hitSlop={12}>
                <Text style={styles.modalFooterCancel}>Cancel</Text>
              </Pressable>
            </View>
            {hasPendingChanges && (
              <Pressable
                onPress={handleDone}
                style={styles.modalFooterDone}
                accessibilityRole="button"
                accessibilityLabel="Confirm list changes"
                hitSlop={12}
              >
                <Text style={styles.modalFooterDoneText}>Done</Text>
              </Pressable>
            )}
          </View>

        </View>
      </Modal>
      <Modal
        visible={newListModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => closeNewListModal({ reopenList: true })}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => closeNewListModal({ reopenList: true })}
        />
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
              style={styles.newListInput}
              autoFocus
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={handleCreateNewList}
            />
            {newListError && <Text style={styles.newListError}>{newListError}</Text>}
            <View style={styles.newListActions}>
              <Pressable
                onPress={() => closeNewListModal({ reopenList: true })}
                style={[styles.newListButton, styles.newListButtonSecondary]}
              >
                <Text style={styles.newListButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreateNewList}
                style={[styles.newListButton, styles.newListButtonPrimary]}
              >
                <Text style={styles.newListButtonPrimaryText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={!!bulkMovePrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setBulkMovePrompt(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setBulkMovePrompt(null)} />
        {bulkMovePrompt && (
          <View style={styles.bulkModalContent}>
            {bulkMoveListNames.length === 1 ? (
              <>
                <Text style={styles.bulkModalMessage}>
                  <Text style={styles.bulkModalHighlight}>{bulkMovePrompt.locationLabel}</Text>
                  {` is also on the wishlist of `}
                  <Text style={styles.bulkModalListName}>{bulkMoveListNames[0]}</Text>
                  {`.`}
                </Text>
                <Text style={styles.bulkModalMessageSecondary}>
                  Move it to Favorites in that list too?
                </Text>
              </>
            ) : bulkMoveListNames.length > 1 ? (
              <>
                <Text style={styles.bulkModalMessage}>
                  <Text style={styles.bulkModalHighlight}>{bulkMovePrompt.locationLabel}</Text>
                  {` is also on the wishlists of `}
                  {bulkMoveDisplayNames.map((name, index) => (
                    <Text key={`${name}-${index}`} style={styles.bulkModalListName}>
                      {index > 0 ? `, ${name}` : name}
                    </Text>
                  ))}
                  {bulkMoveShowEtc ? ", etc." : ""}
                </Text>
                <Text style={styles.bulkModalMessageSecondary}>
                  Move it to Favorites in all of them?
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.bulkModalMessage}>
                  <Text style={styles.bulkModalHighlight}>{bulkMovePrompt.locationLabel}</Text>
                  {` is also in other wishlists.`}
                </Text>
                <Text style={styles.bulkModalMessageSecondary}>
                  Move it to Favorites in those lists too?
                </Text>
              </>
            )}
            <View style={styles.bulkModalActions}>
              <Pressable
                style={[styles.bulkModalButton, styles.bulkModalButtonPrimary]}
                onPress={() => handleBulkMoveDecision(true)}
              >
                <Text style={[styles.bulkModalButtonText, styles.bulkModalButtonPrimaryText]}>Yes</Text>
              </Pressable>
              <Pressable
                style={[styles.bulkModalButton, styles.bulkModalButtonSecondary]}
                onPress={() => handleBulkMoveDecision(false)}
              >
                <Text style={[styles.bulkModalButtonText, styles.bulkModalButtonSecondaryText]}>No</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

function CompassButton({ heading, onPress }: { heading: number; onPress: () => void }) {
  if (Math.abs(heading) < 3) return null;

  return (
    <Pressable
      onPress={onPress}
      style={styles.compassBtn}
      accessibilityRole="button"
      accessibilityLabel="Reset map orientation"
    >
      <Text style={styles.compassText}>N</Text>
      <View
        style={[
          styles.compassNeedleWrapper,
          { transform: [{ rotate: `${-heading}deg` }] },
        ]}
      >
        <FontAwesome name="location-arrow" size={16} color="#fff" style={styles.compassArrow} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  searchBar: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: "white",
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 10,
  },
  recenter: {
    position: "absolute",
    bottom: 24,
    right: 24,
    alignItems: "flex-end",
    gap: 12,
  },
  recenterBtn: {
    minWidth: 120,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  recenterText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  compassBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  compassText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 1,
  },
  compassNeedleWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  compassArrow: {
    marginTop: 2,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
    overflow: "hidden",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 48,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  sheetHeaderCollapsed: {
    marginBottom: 12,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  sheetClose: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.08)",
  },
  sheetCloseText: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 13,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginBottom: 20,
    gap: 12,
  },
  heartButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  heartButtonSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  heartIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  heartIconWrapperSmall: {
    transform: [{ scale: 0.9 }],
  },
  heartSparkle: {
    position: "absolute",
    top: -10,
    right: -8,
    fontSize: 14,
  },
  heartSparkleSmall: {
    top: -8,
    right: -6,
    fontSize: 12,
  },
  sheetBody: {
    gap: 12,
  },
  sheetMeta: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
  },
  sheetHint: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
  },
  modalContent: {
    position: "absolute",
    left: 20,
    right: 20,
    top: "25%",
    alignSelf: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  modalTitleLocation: {
    color: "#6b7280",
    fontWeight: "600",
  },
  modalList: {
    paddingBottom: 4,
  },
  modalListWrapper: {
    maxHeight: 220,
  },
  modalListItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  modalListText: {
    fontSize: 14,
    color: "#1f2937",
  },
  modalListHeartButton: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  modalListIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 20,
  },
  modalListIconSparkle: {
    position: "absolute",
    top: -10,
    right: -8,
    fontSize: 12,
  },
  modalEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 12,
  },
  modalEmptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  modalEmptySubtitle: {
    fontSize: 13,
    color: "#4b5563",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  modalEmptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5f5",
    backgroundColor: "#f8fafc",
  },
  modalEmptyButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 20,
  },
  modalFooterLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  modalNewListButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd5f5",
  },
  modalNewListText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0f172a",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  modalFooterCancel: {
    fontSize: 14,
    color: "#9ca3af",
    fontWeight: "600",
  },
  modalFooterDone: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1d4ed8",
  },
  modalFooterDoneText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  newListModalWrapper: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  newListModal: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 24,
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 12,
  },
  newListTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  newListInput: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#0f172a",
  },
  newListError: {
    fontSize: 13,
    color: "#ef4444",
  },
  newListActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 8,
  },
  newListButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  newListButtonSecondary: {
    backgroundColor: "#e2e8f0",
  },
  newListButtonPrimary: {
    backgroundColor: "#6366f1",
  },
  newListButtonSecondaryText: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "600",
  },
  newListButtonPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  bulkModalContent: {
    position: "absolute",
    left: 28,
    right: 28,
    top: "32%",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 22,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 18,
  },
  bulkModalHighlight: {
    fontWeight: "700",
    color: "#0f172a",
  },
  bulkModalMessage: {
    fontSize: 14,
    color: "#4b5563",
    textAlign: "center",
    lineHeight: 20,
  },
  bulkModalListWrapper: {
    marginTop: 10,
    marginBottom: 4,
    gap: 6,
  },
  bulkModalBullet: {
    fontSize: 14,
    color: "#4b5563",
  },
  bulkModalListName: {
    fontStyle: "italic",
    color: "#0f172a",
  },
  bulkModalMessageSecondary: {
    fontSize: 14,
    color: "#0f172a",
    textAlign: "center",
    marginTop: 12,
  },
  bulkModalActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 24,
  },
  bulkModalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  bulkModalButtonPrimary: {
    backgroundColor: "#dcfce7",
  },
  bulkModalButtonPrimaryText: {
    color: "#166534",
  },
  bulkModalButtonSecondary: {
    backgroundColor: "#f1f5f9",
  },
  bulkModalButtonSecondaryText: {
    color: "#0f172a",
  },
  bulkModalButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
