import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Feature} from '../types';

interface Props {
  feature: Feature;
  brandColor: string;
  accentColor: string;
}

const ICON_MAP: Record<string, string> = {
  mail: '\u2709',
  ai: '\u2728',
  social: '\ud835\udccd',
  code: '\u276f',
};

export const FeatureDemo: React.FC<Props> = ({feature, brandColor, accentColor}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Phase 1: Pill appears (0-20)
  // Phase 2: UI expands (20-40)
  // Phase 3: Text types (40-150)
  // Phase 4: Caption appears (120-170)
  // Phase 5: Collapse (170-195)

  const pillScale = spring({
    frame,
    fps,
    config: {damping: 12, stiffness: 100},
  });

  // Audio bars animation
  const bars = [0.4, 0.7, 1.0, 0.6, 0.8];
  const barHeights = bars.map((base, i) => {
    const wave = Math.sin((frame * 0.3) + i * 1.5) * 0.4 + 0.6;
    return base * wave * 40;
  });

  // UI card expand
  const expandStart = 20;
  const expandProgress = frame > expandStart
    ? spring({frame: frame - expandStart, fps, config: {damping: 14, stiffness: 80}})
    : 0;

  const cardScale = interpolate(expandProgress, [0, 1], [0, 1]);
  const cardOpacity = interpolate(expandProgress, [0, 0.3], [0, 1], {extrapolateRight: 'clamp'});

  // Text typing
  const typeStart = 40;
  const allText = feature.demoLines.join('\n');
  const charsToShow = frame > typeStart
    ? Math.floor((frame - typeStart) * 1.2)
    : 0;
  const visibleText = allText.slice(0, charsToShow);

  // Caption
  const captionStart = 120;
  const captionOpacity = frame > captionStart
    ? interpolate(frame - captionStart, [0, 15], [0, 1], {extrapolateRight: 'clamp'})
    : 0;

  // Collapse
  const collapseStart = 170;
  const collapseProgress = frame > collapseStart
    ? interpolate(frame, [collapseStart, 195], [0, 1], {extrapolateRight: 'clamp'})
    : 0;
  const overallCardOpacity = interpolate(collapseProgress, [0, 0.8], [1, 0], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* UI Card */}
      {expandProgress > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '12%',
            width: 700,
            minHeight: 350,
            backgroundColor: '#FAFAF8',
            borderRadius: 16,
            padding: 32,
            boxShadow: `0 0 40px rgba(37, 99, 235, 0.12), 0 2px 8px rgba(0,0,0,0.06)`,
            border: '1px solid rgba(37, 99, 235, 0.15)',
            transform: `scale(${cardScale})`,
            opacity: cardOpacity * overallCardOpacity,
          }}
        >
          {/* App header */}
          <div style={{fontSize: 14, color: '#888', marginBottom: 16, fontFamily: 'system-ui'}}>
            {feature.appName}
          </div>

          {/* Typed content */}
          <div
            style={{
              fontSize: 18,
              lineHeight: 1.6,
              color: brandColor,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              whiteSpace: 'pre-wrap',
              minHeight: 200,
            }}
          >
            {visibleText}
            {charsToShow < allText.length && charsToShow > 0 && (
              <span
                style={{
                  opacity: Math.sin(frame * 0.4) > 0 ? 1 : 0,
                  color: accentColor,
                }}
              >
                |
              </span>
            )}
          </div>
        </div>
      )}

      {/* Dynamic Island Pill */}
      <div
        style={{
          position: 'absolute',
          bottom: '15%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backgroundColor: brandColor,
          borderRadius: 40,
          padding: '14px 28px',
          transform: `scale(${pillScale * (1 - collapseProgress * 0.3)})`,
          opacity: 1 - collapseProgress,
        }}
      >
        {/* Icon */}
        <span style={{fontSize: 22}}>
          {ICON_MAP[feature.icon] || '\u25cf'}
        </span>

        {/* Audio bars */}
        <div style={{display: 'flex', alignItems: 'center', gap: 3, height: 40}}>
          {barHeights.map((h, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: h,
                backgroundColor: 'white',
                borderRadius: 3,
              }}
            />
          ))}
        </div>

        {/* Caption text */}
        {captionOpacity > 0 && (
          <span
            style={{
              color: 'white',
              fontSize: 18,
              fontWeight: 500,
              fontFamily: 'system-ui',
              marginLeft: 8,
              opacity: captionOpacity,
            }}
          >
            {feature.caption}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};
