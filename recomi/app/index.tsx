import { Redirect } from "expo-router";
import { useAuth } from "@/shared/context/auth";

export default function Index() {
  const { user } = useAuth();
  if (user) {
    return <Redirect href="/(tabs)/map" />;
  }
  return <Redirect href="/welcome" />;
}
