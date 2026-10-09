import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { TransientSharePayload } from '@/lib/transientSharePayload';
import { fonts, radius, spacing } from '@/constants/theme';

export interface TransientShareBannerProps {
  payload: TransientSharePayload | null;
  onDismiss: () => void;
  onReview?: () => void;
  isExtracting?: boolean;
}

export function TransientShareBanner({
  payload,
  onDismiss,
  onReview,
  isExtracting = false,
}: TransientShareBannerProps) {
  const colors = useColors();

  if (!payload) {
    return null;
  }

  return (
    <View
      style={[
        s.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
      testID="transient-share-banner"
    >
      {/* Top bar: Title + Badge + Dismiss */}
      <View style={s.topBar}>
        <View style={s.titleRow}>
          <Feather name="share-2" size={16} color={colors.foreground} />
          <Text style={[s.titleText, { color: colors.foreground }]}>
            Received Shared Content
          </Text>
          <View
            style={[
              s.badge,
              {
                backgroundColor:
                  payload.type === 'url' ? '#E0F2FE' : '#DCFCE7',
              },
            ]}
          >
            <Text
              style={[
                s.badgeText,
                {
                  color: payload.type === 'url' ? '#0369A1' : '#15803D',
                },
              ]}
            >
              {payload.type.toUpperCase()}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [s.dismissButton, { opacity: pressed ? 0.7 : 1 }]}
          testID="transient-share-dismiss-btn"
          accessibilityLabel="Dismiss shared content"
        >
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Subject line if present */}
      {payload.subject ? (
        <View style={s.subjectRow}>
          <Text style={[s.label, { color: colors.mutedForeground }]}>
            Subject:
          </Text>
          <Text style={[s.valueText, { color: colors.foreground }]} numberOfLines={1}>
            {payload.subject}
          </Text>
        </View>
      ) : null}

      {/* Sanitized URL preview if URL type */}
      {payload.type === 'url' && payload.sanitizedUrl ? (
        <View style={s.urlRow}>
          <Feather name="shield" size={14} color="#0284C7" />
          <Text style={[s.urlLabel, { color: colors.mutedForeground }]}>
            Sanitized URL:
          </Text>
          <Text
            style={[s.urlText, { color: colors.foreground }]}
            numberOfLines={2}
            selectable={true}
          >
            {payload.sanitizedUrl}
          </Text>
        </View>
      ) : null}

      {/* Raw Content snippet */}
      <View style={s.contentBox}>
        <Text style={[s.label, { color: colors.mutedForeground }]}>
          Raw Payload Snippet:
        </Text>
        <Text
          style={[s.contentText, { color: colors.foreground }]}
          numberOfLines={3}
          selectable={true}
        >
          {payload.rawContent}
        </Text>
      </View>

      {/* Review & Import Button */}
      {onReview ? (
        <Pressable
          onPress={onReview}
          disabled={isExtracting}
          style={({ pressed }) => [
            s.reviewBtn,
            { backgroundColor: colors.accent, opacity: pressed || isExtracting ? 0.7 : 1 },
          ]}
          testID="transient-share-review-btn"
        >
          <Feather name="edit-3" size={14} color="#FFF" />
          <Text style={s.reviewBtnText}>
            {isExtracting ? 'Extracting Candidate...' : 'Review & Import Recipe'}
          </Text>
        </Pressable>
      ) : null}

      {/* Privacy guarantee disclaimer footer */}
      <View style={s.disclaimerRow}>
        <Feather name="lock" size={12} color={colors.mutedForeground} />
        <Text style={[s.disclaimerText, { color: colors.mutedForeground }]}>
          Volatile in-memory payload only. Not written to disk, not fetched, and not transmitted.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: 12,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  titleText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 14,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  badgeText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '700',
  },
  dismissButton: {
    padding: 4,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  valueText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    flex: 1,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0F9FF',
    padding: 6,
    borderRadius: radius.sm,
  },
  urlLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
  },
  urlText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    flex: 1,
  },
  contentBox: {
    gap: 2,
  },
  contentText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    marginTop: 4,
  },
  reviewBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    color: '#FFF',
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  disclaimerText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontStyle: 'italic',
    flex: 1,
  },
});
