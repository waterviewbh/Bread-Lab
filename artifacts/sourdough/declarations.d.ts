declare module "react-native-math-view" {
  import { Component } from "react";
  import { StyleProp, ViewStyle } from "react-native";

  export interface MathViewProps {
    math: string;
    style?: StyleProp<ViewStyle> & { color?: string };
    config?: Record<string, any>;
  }

  export default class MathView extends Component<MathViewProps> {}
}
