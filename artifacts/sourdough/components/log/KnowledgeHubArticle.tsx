// artifacts/sourdough/components/log/KnowledgeHubArticle.tsx
import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, ActivityIndicator, Modal } from "react-native";
import { useColors } from "@/hooks/useColors";
import { fonts, spacing, radius, typography } from "@/constants/theme";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DIAGNOSTIC_SCIENCE, DiagnosticScienceArticle } from "@/constants/diagnosticContents";
import { ScienceArticle } from "@/lib/scienceArticles";
import { useScienceArticle } from "@/hooks/useScienceArticle";
import { MathjaxFactory } from "react-native-math-view";
import { SvgXml } from "react-native-svg";

const mathjax = MathjaxFactory({ ex: 8, em: 16 });

interface Props {
  slug: string;
  onClose: () => void;
}

// Type Guard Helper
function isScienceArticle(
  article: DiagnosticScienceArticle | ScienceArticle
): article is ScienceArticle {
  return (article as ScienceArticle).blocks !== undefined;
}

/**
 * Basic Inline Markdown Parser
 * Supports **bold** (semi-bold) and *italic* formatting.
 */
function InlineMarkdown({ text, style }: { text: string; style?: any }) {
  // Capture **text** or *text* groups
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);

  return (
    <Text selectable={true} style={style}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <Text key={i} style={{ fontWeight: "700" }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith("*") && part.endsWith("*")) {
          return (
            <Text key={i} style={{ fontStyle: "italic" }}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

/**
 * Robust LaTeX Renderer
 * Powered by react-native-math-view for full KaTeX/LaTeX support.
 */
function LatexRenderer({ formula, colors }: { formula: string; colors: any }) {
  const [modalVisible, setModalVisible] = React.useState(false);

  const result = React.useMemo(() => {
    try {
      return mathjax.toSVG(formula);
    } catch (e) {
      console.error("MathJax pure JS converter failure:", e);
      return null;
    }
  }, [formula]);

  if (!result || !result.svg) {
    return null;
  }

  const modalWidth = result.size.width * 1.5;
  const modalHeight = result.size.height * 1.5;

  return (
    <>
      <Pressable
        onPress={() => setModalVisible(true)}
        style={({ pressed }) => [s.mathPressable, pressed && { opacity: 0.7 }]}
      >
        <View style={s.mathContainer}>
          <SvgXml
            xml={result.svg}
            width={result.size.width}
            height={result.size.height}
            fill={colors.foreground}
          />
        </View>
      </Pressable>

      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent={true}
        supportedOrientations={["portrait", "landscape"]}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={[s.modalVeil, { backgroundColor: "rgba(0,0,0,0.85)" }]}>
          <Pressable style={s.modalCloseArea} onPress={() => setModalVisible(false)}>
            <Ionicons name="close" size={28} color="#FFF" style={s.modalCloseIcon} />
          </Pressable>

          <ScrollView
            horizontal
            contentContainerStyle={s.modalScrollContent}
            showsHorizontalScrollIndicator={true}
          >
            <ScrollView contentContainerStyle={s.modalScrollContentVertical}>
              <View style={[s.modalMathBox, { backgroundColor: colors.background }]}>
                <SvgXml
                  xml={result.svg}
                  width={modalWidth}
                  height={modalHeight}
                  fill={colors.foreground}
                />
              </View>
            </ScrollView>
          </ScrollView>

          <Text style={s.modalHintText}>Tip: Flip device sideways for wide equations</Text>
        </View>
      </Modal>
    </>
  );
}

/**
 * Knowledge Hub Article Viewer
 * Renders educational content for a specific diagnostic defect or a scholarly science article.
 */
export function KnowledgeHubArticle({ slug, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const isDiagnostic = !!DIAGNOSTIC_SCIENCE[slug];
  const diagnosticContent = DIAGNOSTIC_SCIENCE[slug];

  const { data: scienceContent, isLoading } = useScienceArticle(isDiagnostic ? "" : slug);
  const content = isDiagnostic ? diagnosticContent : scienceContent;

  if (isLoading && !content) {
    return (
      <View style={[s.container, { backgroundColor: colors.background }]}>
         <View style={[s.header, { paddingTop: insets.top + 20, borderBottomColor: colors.border }]}>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Resources</Text>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={[s.content, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!content) {
    return (
      <View style={[s.container, { backgroundColor: colors.background }]}>
         <View style={[s.header, { paddingTop: insets.top + 20, borderBottomColor: colors.border }]}>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Resources</Text>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={s.content}>
          <Text selectable={true} style={[s.body, { color: colors.mutedForeground }]}>Educational content for "{slug}" is coming soon.</Text>
        </View>
      </View>
    );
  }

  const isScholarly = isScienceArticle(content);

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.header, { paddingTop: insets.top + 20, borderBottomColor: colors.border }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Resources</Text>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.categoryBadge, { backgroundColor: colors.primary + '20' }]}>
          <Text selectable={true} style={[s.categoryText, { color: colors.primary }]}>
            {isScholarly ? "BREAD SCIENCE" : "OUTCOME ANALYSIS"}
          </Text>
        </View>

        <Text selectable={true} style={[s.title, { color: colors.foreground }]}>{content.title}</Text>

        {isScholarly ? (
          // Scholarly Science Article Layout (Fluid Block Stream)
          <>
            {content.blocks.map((block, bIdx) => {
              if (block.type === "paragraph") {
                return (
                  <InlineMarkdown
                    key={bIdx}
                    text={block.text}
                    style={[
                      s.body,
                      { color: colors.foreground },
                      block.italic && { fontStyle: "italic", marginBottom: 24 }
                    ]}
                  />
                );
              }

              if (block.type === "heading") {
                return (
                  <Text selectable={true} key={bIdx} style={[s.sectionTitle, { color: colors.foreground, marginTop: 16, marginBottom: 12 }]}>
                    {block.text}
                  </Text>
                );
              }

              if (block.type === "equation") {
                return (
                  <View key={bIdx} style={s.mathBox}>
                    <LatexRenderer formula={block.text} colors={colors} />
                  </View>
                );
              }

              return null;
            })}


            <Text selectable={true} style={[s.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>
              Further Study Topics
            </Text>
            <View style={s.driverBox}>
              {content.furtherStudyTopics.map((topic, i) => (
                <View key={i} style={s.bulletRow}>
                  <View style={[s.bulletDot, { backgroundColor: colors.accent }]} />
                  <InlineMarkdown
                    text={topic}
                    style={[s.bulletText, { color: colors.foreground }]}
                  />
                </View>
              ))}
            </View>
          </>
        ) : (
          // Troubleshooting / Diagnostic Article Layout
          <>
            <Text selectable={true} style={[s.sectionTitle, { color: colors.foreground }]}>The Mechanics</Text>
            <InlineMarkdown text={content.mechanics} style={[s.body, { color: colors.foreground }]} />

            <Text selectable={true} style={[s.sectionTitle, { color: colors.foreground }]}>Process Drivers</Text>
            <View style={s.driverBox}>
              <Text selectable={true} style={[s.driverLabel, { color: colors.mutedForeground }]}>PRIMARY DRIVER</Text>
              <InlineMarkdown text={content.primaryDriver} style={[s.driverValue, { color: colors.foreground }]} />

              <Text selectable={true} style={[s.driverLabel, { color: colors.mutedForeground, marginTop: 12 }]}>SECONDARY DRIVERS</Text>
              {content.secondaryDrivers.map((d, i) => (
                <View key={i} style={s.bulletRow}>
                  <View style={[s.bulletDot, { backgroundColor: colors.accent }]} />
                  <InlineMarkdown text={d} style={[s.bulletText, { color: colors.foreground }]} />
                </View>
              ))}
            </View>

            <Text selectable={true} style={[s.sectionTitle, { color: colors.foreground }]}>Single-Variable Interventions</Text>
            <View style={[s.tipsBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <View style={s.tipsHeader}>
                <Feather name="zap" size={16} color={colors.accent} />
                <Text selectable={true} style={[s.tipsTitle, { color: colors.foreground }]}>ACTION</Text>
              </View>
              <InlineMarkdown text={content.interventionAction} style={[s.interventionText, { color: colors.foreground }]} />

              <View style={[s.tipsHeader, { marginTop: 16 }]}>
                <Feather name="shield" size={16} color={colors.primary} />
                <Text selectable={true} style={[s.tipsTitle, { color: colors.foreground }]}>LOGIC BOUNDARY</Text>
              </View>
              <InlineMarkdown text={content.logicBoundary} style={[s.interventionText, { color: colors.mutedForeground }]} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontFamily: fonts.serifBold },
  closeBtn: { padding: 4 },
  content: { padding: 20, paddingBottom: 60 },
  categoryBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, marginBottom: 12 },
  categoryText: { fontSize: 10, fontFamily: fonts.semiSansBold, letterSpacing: 1 },
  title: { fontSize: 28, fontFamily: fonts.serifBold, marginBottom: 24, lineHeight: 34 },
  sectionTitle: { fontSize: 14, fontFamily: fonts.semiSansBold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  body: { fontSize: 16, fontFamily: fonts.sans, lineHeight: 26, marginBottom: 30 },
  driverBox: { marginBottom: 30 },
  driverLabel: { fontSize: 10, fontFamily: fonts.semiSansBold, letterSpacing: 0.5, marginBottom: 4 },
  driverValue: { fontSize: 15, fontFamily: fonts.sansMedium },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  bulletDot: { width: 4, height: 4, borderRadius: 2 },
  bulletText: { fontSize: 14, fontFamily: fonts.sans, flex: 1 },
  tipsBox: { padding: 20, borderRadius: radius.lg, borderWidth: 1 },
  tipsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tipsTitle: { fontSize: 11, fontFamily: fonts.semiSansBold, letterSpacing: 0.5 },
  interventionText: { fontSize: 15, fontFamily: fonts.sansMedium, lineHeight: 22 },
  principleBlock: { marginBottom: 8 },
  principleHeading: { fontSize: 15, fontFamily: fonts.sansSemiBold, marginBottom: 4 },
  mathBox: { paddingVertical: 12, paddingHorizontal: 4, marginBottom: 20 },
  mathContainer: { alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  mathRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  mathPressable: { padding: 6, borderRadius: radius.md, width: '100%', alignItems: 'center' },
  modalVeil: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  modalCloseArea: { position: "absolute", top: 40, right: 20, zIndex: 10, padding: 10 },
  modalCloseIcon: { opacity: 0.9 },
  modalScrollContent: { alignItems: "center", justifyContent: "center" },
  modalScrollContentVertical: { alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  modalMathBox: { padding: 24, borderRadius: radius.lg, minWidth: 200, alignItems: 'center', justifyContent: 'center', shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  modalHintText: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: fonts.sans, position: "absolute", bottom: 40, textAlign: "center" },
});
