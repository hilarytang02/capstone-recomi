import React from "react"
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native"

type ReportModalProps = {
  visible: boolean
  title: string
  reason: string
  loading?: boolean
  onChangeReason: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

export default function ReportModal({
  visible,
  title,
  reason,
  loading = false,
  onChangeReason,
  onClose,
  onSubmit,
}: ReportModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.helper}>Reason is optional for now.</Text>
          <TextInput
            value={reason}
            onChangeText={onChangeReason}
            placeholder="Why are you reporting this?"
            placeholderTextColor="#94a3b8"
            multiline
            style={styles.input}
            editable={!loading}
            maxLength={300}
          />
          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onClose} disabled={loading}>
              <Text style={styles.secondaryLabel}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.primaryButton, loading && styles.disabled]} onPress={onSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryLabel}>Submit</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.42)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  helper: {
    fontSize: 13,
    color: "#64748b",
  },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0f172a",
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  secondaryButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#e2e8f0",
  },
  secondaryLabel: {
    color: "#0f172a",
    fontWeight: "600",
  },
  primaryButton: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "#0f172a",
    minWidth: 84,
    alignItems: "center",
  },
  primaryLabel: {
    color: "#fff",
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.6,
  },
})
