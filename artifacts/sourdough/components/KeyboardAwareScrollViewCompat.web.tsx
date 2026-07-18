// Web build: drop-in that imports nothing from react-native-keyboard-controller.
// Metro automatically prefers this file over the .tsx version on web.
import { ScrollView, ScrollViewProps } from "react-native";

// Reuse the same prop shape without importing the native type
type Props = ScrollViewProps & { keyboardShouldPersistTaps?: "always" | "never" | "handled" };

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  return (
    <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
      {children}
    </ScrollView>
  );
}