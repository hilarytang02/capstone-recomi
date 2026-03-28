import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

type RemoteAvatarProps = {
  uri: string | null | undefined;
  label: string;
  size: number;
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
};

export default function RemoteAvatar({
  uri,
  label,
  size,
  backgroundColor = "#e2e8f0",
  textColor = "#475569",
  fontSize,
}: RemoteAvatarProps) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [uri]);

  const initial = label.trim().charAt(0).toUpperCase() || "?";
  const radius = size / 2;
  const resolvedFontSize = fontSize ?? Math.max(12, Math.round(size * 0.38));

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: radius }]}>
      <View
        style={[
          styles.fallback,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor,
          },
        ]}
      >
        <Text style={{ fontSize: resolvedFontSize, fontWeight: "700", color: textColor }}>{initial}</Text>
      </View>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={[
            styles.image,
            {
              width: size,
              height: size,
              borderRadius: radius,
              opacity: loaded ? 1 : 0,
            },
          ]}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    position: "absolute",
    top: 0,
    left: 0,
  },
});
