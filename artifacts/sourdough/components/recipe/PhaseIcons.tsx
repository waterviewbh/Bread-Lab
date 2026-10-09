import React from 'react';
import Svg, { Circle, Path, Rect, Ellipse, G } from 'react-native-svg';
import { View } from 'react-native';

export type PhaseIconState = 'empty' | 'some' | 'both';

export interface PhaseIconProps {
  phaseKey: string;
  state?: PhaseIconState;
  size?: number;
}

export function PhaseIcon({ phaseKey, state = 'some', size = 32 }: PhaseIconProps) {
  const isBoth = state === 'both';
  const isEmpty = state === 'empty';

  // Palette based on Stitch design specs
  const bg = isBoth ? '#4A3B32' : '#FDFBF9';
  const stroke = isBoth ? '#FDFBF9' : '#5D3A26';
  const fill = isBoth ? '#614B3D' : '#F4EBD9';
  const accent = '#E0824B';
  const secondaryAccent = isBoth ? '#9EC2CF' : '#5D3A26';

  return (
    <View style={{ width: size, height: size, opacity: isEmpty ? 0.2 : 1 }}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" fill="none">
        {/* Outer Circle */}
        <Circle cx="50" cy="50" r="46" fill={bg} stroke={stroke} strokeWidth="2.5" />

        {/* Phase-specific artwork */}
        {renderPhaseArtwork(phaseKey, fill, stroke, accent, secondaryAccent, isBoth)}
      </Svg>
    </View>
  );
}

function renderPhaseArtwork(
  key: string,
  fill: string,
  stroke: string,
  accent: string,
  secondaryAccent: string,
  isBoth: boolean
) {
  switch (key) {
    case 'building_levain':
      return (
        <>
          <Path d="M36 28h28v6H36z" fill={stroke} />
          <Path d="M38 34h24l6 44a8 8 0 01-8 8H40a8 8 0 01-8-8z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M34 58c4-2 10 2 16 0s10-2 16 0" stroke={stroke} strokeLinecap="round" strokeWidth="2" />
          <Circle cx="44" cy="68" fill={accent} r="2.5" />
          <Circle cx="56" cy="64" fill={accent} r="3" />
          <Circle cx="48" cy="74" fill={secondaryAccent} r="2" />
          <Circle cx="58" cy="72" fill={secondaryAccent} r="1.5" />
        </>
      );

    case 'scalding':
      return (
        <>
          <Path d="M26 62h48c0 14-11 20-24 20S26 76 26 62z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M22 62h56" stroke={stroke} strokeLinecap="round" strokeWidth="2.5" />
          <Path d="M40 52c-2-8 3-14 0-22M50 48c-2-7 3-13 0-20M60 52c-2-8 3-14 0-22" stroke={accent} strokeLinecap="round" strokeWidth="2.5" />
        </>
      );

    case 'toasting_flour':
      return (
        <>
          <Ellipse cx="44" cy="56" rx="26" ry="12" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M70 56l14-6" stroke={stroke} strokeLinecap="round" strokeWidth="3.5" />
          <Circle cx="36" cy="55" fill={accent} r="2.5" />
          <Circle cx="46" cy="58" fill={accent} r="2.5" />
          <Circle cx="52" cy="53" fill={secondaryAccent} r="2" />
          <Path d="M38 42c-2-4 1-7 0-10M48 40c-2-4 1-7 0-10" stroke={accent} strokeLinecap="round" strokeWidth="2" />
        </>
      );

    case 'soaking_seeds':
      return (
        <>
          <Path d="M28 36h44l-4 44a6 6 0 01-6 6H38a6 6 0 01-6-6z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M30 52c5-3 10 3 20 0s12 3 20 0" stroke="#9EC2CF" strokeLinecap="round" strokeWidth="2.5" />
          <Path d="M40 64c0 3 3 5 5 2s-1-5-5-2zm14 8c0 3 3 5 5 2s-1-5-5-2zm6-12c0 3 3 5 5 2s-1-5-5-2z" fill={secondaryAccent} />
        </>
      );

    case 'autolysing':
      return (
        <>
          <Path d="M22 46h56c0 20-13 32-28 32S22 66 22 46z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Circle cx="50" cy="30" fill={isBoth ? '#4A3B32' : '#FDFBF9'} r="12" stroke={stroke} strokeWidth="2" />
          <Path d="M50 24v6l4 3" stroke={accent} strokeLinecap="round" strokeWidth="2" />
          <Path d="M28 58c8 4 14-3 22 2s14-3 22 1" stroke={stroke} strokeWidth="2" />
        </>
      );

    case 'fermentolysing':
      return (
        <>
          <Path d="M22 48h56c0 20-13 32-28 32S22 68 22 48z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M46 22h8v16c0 4-8 4-8 0z" fill={accent} />
          <Circle cx="36" cy="62" fill={accent} r="3" />
          <Circle cx="60" cy="60" fill={accent} r="4" />
          <Circle cx="48" cy="68" fill={secondaryAccent} r="2.5" />
        </>
      );

    case 'incorporating':
      return (
        <>
          <Path d="M22 52h56c0 18-12 28-28 28S22 70 22 52z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M42 24l8 24 8-24" stroke={stroke} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
          <Path d="M38 32c4-2 20-2 24 0" stroke={accent} strokeLinecap="round" strokeWidth="2" />
        </>
      );

    case 'delaying_salt':
      return (
        <>
          <Path d="M24 54c0 16 12 26 26 26s26-10 26-26H24z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M44 24h12l2 14H42z" fill={isBoth ? '#4A3B32' : '#FDFBF9'} stroke={stroke} strokeWidth="2" />
          <Circle cx="47" cy="44" fill="#9EC2CF" r="1.5" />
          <Circle cx="53" cy="44" fill="#9EC2CF" r="1.5" />
          <Circle cx="50" cy="48" fill="#9EC2CF" r="1.5" />
        </>
      );

    case 'bassinage':
      return (
        <>
          <Path d="M24 56c0 16 12 24 26 24s26-8 26-24H24z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M50 20c0 8-6 14-6 18a6 6 0 0012 0c0-4-6-10-6-18z" fill="#9EC2CF" />
          <Path d="M38 64c6 2 18 2 24 0" stroke="#9EC2CF" strokeLinecap="round" strokeWidth="2" />
        </>
      );

    case 'adding_inclusions':
      return (
        <>
          <Path d="M22 52c0-14 12-22 28-22s28 8 28 22-12 26-28 26-28-12-28-26z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Circle cx="42" cy="48" fill={accent} r="3" />
          <Circle cx="56" cy="44" fill={secondaryAccent} r="2.5" />
          <Circle cx="50" cy="58" fill={accent} r="3" />
          <Circle cx="36" cy="56" fill={secondaryAccent} r="2" />
          <Circle cx="62" cy="56" fill="#9EC2CF" r="2" />
        </>
      );

    case 'stretching_folding':
      return (
        <>
          <Path d="M30 70c0-10 8-14 20-14s20 4 20 14-8 10-20 10-20 0-20-10z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M50 56V26m0 0l-6 6m6-6l6 6" stroke={accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
          <Path d="M42 42c4-4 12-4 16 0" stroke={stroke} strokeWidth="2" />
        </>
      );

    case 'laminating':
      return (
        <>
          <Path d="M20 54c16-12 44-12 60 0-16 12-44 12-60 0z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M24 40c14-6 38-6 52 0M24 68c14 6 38 6 52 0" stroke={accent} strokeDasharray="3 3" strokeWidth="1.5" />
        </>
      );

    case 'bulk_fermenting':
      return (
        <>
          <Rect fill={fill} height="46" rx="6" stroke={stroke} strokeWidth="2.5" width="48" x="26" y="32" />
          <Path d="M26 48h48" stroke={accent} strokeDasharray="2 2" strokeWidth="2" />
          <Path d="M26 62h48" stroke={accent} strokeDasharray="2 2" strokeWidth="2" />
          <Circle cx="40" cy="68" fill={secondaryAccent} r="3" />
          <Circle cx="58" cy="66" fill={secondaryAccent} r="4" />
          <Circle cx="50" cy="54" fill="#9EC2CF" r="2" />
        </>
      );

    case 'preshaping':
      return (
        <>
          <Ellipse cx="50" cy="56" rx="26" ry="18" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M32 50c4-6 12-8 18-8s14 2 18 8" stroke={accent} strokeLinecap="round" strokeWidth="2" />
          <Path d="M20 74h60" stroke={stroke} strokeLinecap="round" strokeWidth="2" />
        </>
      );

    case 'bench_resting':
      return (
        <>
          <Rect fill={fill} height="20" rx="4" stroke={stroke} strokeWidth="2.5" width="64" x="18" y="50" />
          <Ellipse cx="50" cy="46" rx="18" ry="12" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M38 42c4-4 14-4 24 0" stroke={accent} strokeLinecap="round" strokeWidth="2" />
        </>
      );

    case 'final_shaping':
      return (
        <>
          <Path d="M28 66c0-16 10-26 22-26s22 10 22 26-10 8-22 8-22 0-22-8z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M42 42c4 4 12 4 16 0" stroke={accent} strokeLinecap="round" strokeWidth="2.5" />
          <Path d="M38 52c6 6 18 6 24 0" stroke={accent} strokeLinecap="round" strokeWidth="2.5" />
        </>
      );

    case 'stitching':
      return (
        <>
          <Path d="M26 60c0-14 10-22 24-22s24 8 24 22-10 16-24 16-24-2-24-16z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M38 48l6 8m12-8l6 8m-18-4l6 8" stroke={accent} strokeLinecap="round" strokeWidth="2" />
        </>
      );

    case 'cold_retarding':
      return (
        <>
          <Rect fill={fill} height="52" rx="6" stroke={stroke} strokeWidth="2.5" width="48" x="26" y="24" />
          <Path d="M50 24v52" stroke={stroke} strokeWidth="2" />
          <Path d="M64 48h8M64 56h8" stroke={accent} strokeLinecap="round" strokeWidth="2" />
          <Circle cx="38" cy="40" fill={secondaryAccent} r="2" />
          <Circle cx="38" cy="60" fill={secondaryAccent} r="2" />
        </>
      );

    case 'ambient_proofing':
      return (
        <>
          <Path d="M30 64c0-14 10-24 20-24s20 10 20 24H30z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M42 32c2-6 6-10 8-16 2 6 6 10 8 16" stroke={accent} strokeLinecap="round" strokeWidth="2" />
        </>
      );

    case 'scoring':
      return (
        <>
          <Ellipse cx="50" cy="54" rx="24" ry="16" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M34 50l32 8" stroke={accent} strokeLinecap="round" strokeWidth="3" />
        </>
      );

    case 'the_bake':
      return (
        <>
          <Path d="M22 66h56c0-18-12-30-28-30S22 48 22 66z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          <Path d="M36 40c4-8 10-12 14-18 4 6 10 10 14 18" stroke={accent} strokeLinecap="round" strokeWidth="2.5" />
          <Path d="M30 74h40" stroke={stroke} strokeLinecap="round" strokeWidth="2.5" />
        </>
      );

    default:
      return (
        <Circle cx="50" cy="50" r="30" fill={fill} stroke={stroke} strokeWidth="2.5" />
      );
  }
}
