import React from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import type { SavedEntry } from "../shared/context/savedLists";
import PlaceSocialProof from "./PlaceSocialProof";

type PinDetailSheetProps = {
  entry: SavedEntry | null;
  onClose: () => void;
  bottomInset?: number;
};

export default function PinDetailSheet({ entry, onClose, bottomInset = 0 }: PinDetailSheetProps) {
  const [rendered, setRendered] = React.useState(entry);
  const translateY = React.useRef(new Animated.Value(320)).current;

  React.useEffect(() => {
    if (entry) {
      setRendered(entry);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else if (rendered) {
      Animated.timing(translateY, {
        toValue: 320,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setRendered(null);
        }
      });
    }
  }, [entry, rendered, translateY]);

  if (!rendered) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close place details" />
      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [{ translateY }],
            paddingBottom: bottomInset + 20,
          },
        ]}
      >
        <View style={styles.handle} />
        <View style={styles.content}>
          <View style={styles.titleBlock}>
            <Text style={styles.label} numberOfLines={1}>
              {rendered.pin.label}
            </Text>
            <PlaceSocialProof pin={rendered.pin} />
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss details">
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    zIndex: 1,
  },
  sheet: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
    zIndex: 2,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#cbd5f5",
    alignSelf: "center",
    marginBottom: 12,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
  },
  closeText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
});
