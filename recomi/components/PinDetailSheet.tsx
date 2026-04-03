import React from "react";
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { useSavedLists, type SavedEntry } from "../shared/context/savedLists";
import { coordsMatch } from "../shared/utils/placeStats";
import PlaceSocialProof from "./PlaceSocialProof";
import ReportModal from "./ReportModal";

type PinDetailSheetProps = {
  entry: SavedEntry | null;
  onClose: () => void;
  bottomInset?: number;
  onReport?: (entry: SavedEntry, reason: string) => Promise<void>;
};

export default function PinDetailSheet({ entry, onClose, bottomInset = 0, onReport }: PinDetailSheetProps) {
  const [rendered, setRendered] = React.useState(entry);
  const translateY = React.useRef(new Animated.Value(320)).current;
  const { entries } = useSavedLists();
  const [reportVisible, setReportVisible] = React.useState(false);
  const [reportReason, setReportReason] = React.useState("");
  const [reportSubmitting, setReportSubmitting] = React.useState(false);

  const viewerBucket = React.useMemo(() => {
    if (!rendered) return null;
    const matches = entries.filter((item) => coordsMatch(item.pin, rendered.pin));
    if (matches.some((item) => item.bucket === "favourite")) return "favourite";
    if (matches.some((item) => item.bucket === "wishlist")) return "wishlist";
    return null;
  }, [entries, rendered]);

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

  const handleSubmitReport = async () => {
    if (!onReport) return;
    setReportSubmitting(true);
    try {
      await onReport(rendered, reportReason);
      setReportVisible(false);
      setReportReason("");
      Alert.alert("Report submitted", "Thanks. We’ll review it manually.");
    } catch (error) {
      console.error("Failed to report place", error);
      Alert.alert("Unable to report", "Please try again.");
    } finally {
      setReportSubmitting(false);
    }
  };

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
            <PlaceSocialProof pin={rendered.pin} viewerBucket={viewerBucket} />
          </View>
          <View style={styles.actions}>
            {onReport ? (
              <Pressable
                onPress={() => {
                  setReportReason("");
                  setReportVisible(true);
                }}
                style={styles.reportButton}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Report place"
              >
                {reportSubmitting ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.reportText}>Report</Text>}
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss details">
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
      <ReportModal
        visible={reportVisible}
        title="Report place"
        reason={reportReason}
        loading={reportSubmitting}
        onChangeReason={setReportReason}
        onClose={() => {
          setReportVisible(false);
          setReportReason("");
        }}
        onSubmit={handleSubmitReport}
      />
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
  actions: {
    alignItems: "flex-end",
    gap: 8,
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
  reportButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
  },
  reportText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
});
