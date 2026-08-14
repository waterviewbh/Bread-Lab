// components/AffiliateMilestoneCard.tsx
import React, { useEffect, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { fonts, radius, spacing } from "@/constants/theme";
import { fetchAffiliateItems, AffiliateItem } from "@/lib/affiliateItems";

interface Props {
  milestone: string;
  title: string;
  defaultDescription: string;
  icon?: any;
}

export function AffiliateMilestoneCard({ milestone, title, defaultDescription, icon }: Props) {
  const colors = useColors();
  const [item, setItem] = useState<AffiliateItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAffiliateItems({ milestone }).then((items) => {
      if (items.length > 0) {
        setItem(items[0]);
      }
      setLoading(false);
    });
  }, [milestone]);

  if (loading) {
    return (
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card, justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!item) return null;

  const handlePress = () => {
    if (item.affiliate_url) {
      Linking.openURL(item.affiliate_url).catch(() =>
        console.warn("[AffiliateMilestoneCard] Could not open URL:", item.affiliate_url)
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.header}>
          {icon && <Ionicons name={icon} size={20} color={colors.primary} />}
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        </View>

        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          {item.description || defaultDescription}
        </Text>

        <Pressable
          onPress={handlePress}
          style={({ pressed }) => [
            styles.productRow,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Image
            source={{ uri: item.image_url }}
            style={styles.thumb}
            resizeMode="contain"
          />
          <View style={styles.textBlock}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.ctaRow}>
              <Text style={[styles.cta, { color: colors.primary }]}>View on Amazon</Text>
              <Feather name="external-link" size={12} color={colors.primary} />
            </View>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    minHeight: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
  },
  description: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 12,
  },
  thumb: {
    width: 48,
    height: 48,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cta: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
  },
});
