// components/AffiliateCarousel.tsx
// Rotating gallery of Amazon affiliate product cards.
// - Auto-advances every 6 seconds.
// - Slide-left/slide-right transition using Animated.
// - Fetches from Supabase `affiliate_items` on mount.
// - Silently renders nothing if the table is empty or fetch fails.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { fonts, radius, spacing, typography } from "@/constants/theme";
import { fetchAffiliateItems, AffiliateItem } from "@/lib/affiliateItems";

const INTERVAL_MS = 9000; // 9 seconds per card, up from 6
const SLIDE_DURATION_MS = 280;
const CARD_HEIGHT = 88; // adjust to taste
export default function AffiliateCarousel() {
  const colors = useColors();
  const [items, setItems] = useState<AffiliateItem[]>([]);
  const [index, setIndex] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);  // Fetch on mount — lightweight, no polling
  useEffect(() => {
    fetchAffiliateItems().then(setItems);
  }, []);  // Slide transition: exit left, reset right, enter center
  const advanceTo = useCallback(
    (nextIndex: number) => {
      // Slide current card out to the left
      Animated.timing(translateX, {
        toValue: -400,
        duration: SLIDE_DURATION_MS,
        useNativeDriver: true,
      }).start(() => {
        // Snap to right without animation, then slide in
        translateX.setValue(400);
        setIndex(nextIndex);
        Animated.timing(translateX, {
          toValue: 0,
          duration: SLIDE_DURATION_MS,
          useNativeDriver: true,
        }).start();
      });
    },
    [translateX]
  );
  // Start / restart the auto-advance timer
  useEffect(() => {
    if (items.length < 2) return; // nothing to rotate
    timerRef.current = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % items.length;
        advanceTo(next);
        return prev; // actual state update happens inside advanceTo via setIndex
      });
    }, INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [items.length, advanceTo]);  // Don't render if no items loaded
  if (items.length === 0) return null;

  const current = items[index];
  const handlePress = () => {
    if (current.affiliate_url) {
      Linking.openURL(current.affiliate_url).catch(() =>
        console.warn("[AffiliateCarousel] Could not open URL:", current.affiliate_url)
      );
    }
  };
  return (
    <View style={styles.wrapper}>
      {/* Disclosure label — required for App Store / Amazon Associates compliance */}
      <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
        As an Amazon Associate we earn from qualifying purchases
      </Text>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
            opacity: pressed ? 0.88 : 1,
          },
        ]}
        accessibilityRole="link"
        accessibilityLabel={`Shop: ${current.name}`}
      >
        <Animated.View
          style={[styles.inner, { transform: [{ translateX }] }]}
        >
          {/* Product thumbnail */}
          <Image
            source={{ uri: current.image_url }}
            style={[styles.thumb, { borderRadius: radius.md }]}
            resizeMode="contain"
          />
          {/* Product name + CTA */}
          <View style={styles.textBlock}>
            <Text
              style={[styles.name, { color: colors.foreground }]}
              numberOfLines={2}
            >
              {current.name}
            </Text>
            <View style={styles.ctaRow}>
              <Text style={[styles.cta, { color: colors.primary }]}>
                View on Amazon
              </Text>
              <Feather name="external-link" size={12} color={colors.primary} />
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: spacing.lg,   // 20 — breathing room above
  },
  disclosure: {
    fontFamily: fonts.sans,
    fontSize: 10,
    textAlign: "center",
    marginBottom: 6,
    opacity: 0.7,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
    height: CARD_HEIGHT,
  },
  inner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md, // 16
    gap: 14,
  },
  thumb: {
    width: 60,
    height: 60,
    backgroundColor: "#f5f5f5",  // placeholder bg while image loads
  },
  textBlock: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cta: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
});