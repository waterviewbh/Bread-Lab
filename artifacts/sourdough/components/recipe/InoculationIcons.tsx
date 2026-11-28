/**
 * Bread Lab — Inoculation Cues SVG Component Library
 * Stitch designs, rendered with react-native-svg.
 */
import React from 'react';
import Svg, { Path, Rect, Line, Circle, G, SvgProps } from 'react-native-svg';

export interface InoculationIconProps extends SvgProps {
  size?: number;
  color?: string;
  accent?: string;
  fillDough?: string;
  fillSurface?: string;
}

export const WildYeastIcon: React.FC<InoculationIconProps> = ({
  size = 24, color = '#5d3a26', accent = '#c26d38',
  fillDough = '#f4ebd9', fillSurface = '#fff8f5', ...props
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <Rect x={5.5} y={6} width={13} height={15} rx={2.5} stroke={color} strokeWidth={1.6} fill={fillSurface} strokeLinejoin="round" />
    <Line x1={4.5} y1={6} x2={19.5} y2={6} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    <Line x1={6.5} y1={4.5} x2={17.5} y2={4.5} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Path d="M6.5 13.5 Q12 11.8 17.5 13.5 L17.5 18.5 C17.5 19.8 16.5 20.2 15.5 20.2 L8.5 20.2 C7.5 20.2 6.5 19.8 6.5 18.5 Z" fill={fillDough} stroke={color} strokeWidth={1.2} />
    <Circle cx={9.5} cy={15.8} r={1.1} fill="#ffffff" stroke={color} strokeWidth={0.8} />
    <Circle cx={14} cy={15} r={1.3} fill="#ffffff" stroke={color} strokeWidth={0.8} />
    <Circle cx={11.5} cy={18} r={0.8} fill="#ffffff" stroke={color} strokeWidth={0.6} />
    <Line x1={5.5} y1={16.5} x2={18.5} y2={16.5} stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
    <Circle cx={10} cy={2.2} r={0.75} fill={accent} />
    <Circle cx={13.8} cy={1.8} r={0.9} fill={accent} />
  </Svg>
);

export const CommercialYeastIcon: React.FC<InoculationIconProps> = ({
  size = 24, color = '#5d3a26', accent = '#c26d38',
  fillSurface = '#fff8f5', ...props
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <G transform="rotate(12 12 12)">
      <Rect x={5.5} y={3} width={13} height={15} rx={1.8} fill={fillSurface} stroke={color} strokeWidth={1.6} />
      <Line x1={5.5} y1={6} x2={18.5} y2={6} stroke={color} strokeWidth={1.2} strokeDasharray="1.5 1" />
      <Line x1={5.5} y1={15.5} x2={18.5} y2={15.5} stroke={color} strokeWidth={1.2} strokeDasharray="1.5 1" />
      <Path d="M12 7.8 L12 13.8" stroke={accent} strokeWidth={1.3} strokeLinecap="round" />
      <Path d="M10.2 9.2 L12 10.2 L13.8 9.2" fill="none" stroke={accent} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10.2 11.2 L12 12.2 L13.8 11.2" fill="none" stroke={accent} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 3 L18.5 5.5" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </G>
    <Circle cx={5} cy={18.5} r={1} fill={accent} />
    <Circle cx={7.8} cy={20.5} r={0.8} fill={color} />
    <Circle cx={4} cy={21.5} r={0.7} fill={color} />
    <Circle cx={10} cy={22} r={0.9} fill={accent} />
  </Svg>
);

export const HybridCultureIcon: React.FC<InoculationIconProps> = ({
  size = 24, color = '#5d3a26', accent = '#c26d38',
  fillDough = '#f4ebd9', fillSurface = '#fff8f5', ...props
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <Path d="M4.5 16.5 C3 14 3 10 5.5 8 C8 6 10.5 7.5 12 10 C10.5 12.5 8 14 5.5 16.5 Z" fill={fillDough} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    <Path d="M19.5 7.5 C21 10 21 14 18.5 16 C16 18 13.5 16.5 12 14 C13.5 11.5 16 10 18.5 7.5 Z" fill={fillSurface} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    <Path d="M8.5 12 C10 10 14 14 15.5 12" stroke={accent} strokeWidth={1.6} strokeLinecap="round" fill="none" />
    <Circle cx={6.5} cy={10.5} r={1.1} fill="#ffffff" stroke={color} strokeWidth={0.8} />
    <Circle cx={8} cy={13} r={0.7} fill={accent} />
    <Circle cx={17.5} cy={13.5} r={1} fill={accent} />
    <Circle cx={15.8} cy={11} r={0.75} fill={color} />
    <Path d="M12 4.5 L12 6.5" stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
    <Path d="M12 17.5 L12 19.5" stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

export const PrefermentIcon: React.FC<InoculationIconProps> = ({
  size = 24, color = '#5d3a26', accent = '#c26d38',
  fillDough = '#f4ebd9', ...props
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <Path d="M4 10 C4.5 15.5 7.5 19.5 12 19.5 C16.5 19.5 19.5 15.5 20 10" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    <Line x1={3} y1={10} x2={21} y2={10} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    <Path d="M5.5 10 C5.5 6.5 8.5 5 12 5 C15.5 5 18.5 6.5 18.5 10 Z" fill={fillDough} stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
    <Line x1={9} y1={21} x2={15} y2={21} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Path d="M10 19.5 L9.5 21 M14 19.5 L14.5 21" stroke={color} strokeWidth={1.3} />
    <Circle cx={9} cy={8} r={1.1} fill="#ffffff" stroke={color} strokeWidth={0.8} />
    <Circle cx={13} cy={7.2} r={1.3} fill="#ffffff" stroke={color} strokeWidth={0.8} />
    <Circle cx={16} cy={8.6} r={0.8} fill="#ffffff" stroke={color} strokeWidth={0.7} />
    <Circle cx={8.5} cy={13} r={0.9} fill={accent} />
    <Circle cx={12} cy={14.5} r={1.1} fill="#ffffff" stroke={color} strokeWidth={0.7} />
    <Circle cx={15.5} cy={12.5} r={0.8} fill={accent} />
    <Path d="M12 2.2 L12 3.6" stroke={accent} strokeWidth={1.3} strokeLinecap="round" />
    <Path d="M8.5 3 Q9.5 2.2 10.5 3.2" stroke={accent} strokeWidth={1.1} strokeLinecap="round" fill="none" />
    <Path d="M15.5 3 Q14.5 2.2 13.5 3.2" stroke={accent} strokeWidth={1.1} strokeLinecap="round" fill="none" />
  </Svg>
);

// Labels and light/dark palettes live in InoculantPill.
