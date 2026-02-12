import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {easeInOutQuart, easeOutExpo} from '../easing';

/**
 * Persistent dot that travels across all scenes, creating visual continuity.
 *
 * The dot transforms through the video:
 * - Opening: appears as the orb (handled by BrandReveal, so we start after)
 * - Hook phase: small dot above text, pulsing gently
 * - Features: moves to bottom-left corner, becomes a small anchor
 * - Integrations: moves to center, grows into the ring
 * - Closing: dissolves into the brand wordmark
 */

interface Props {
  brandColor: string;
  accentColor: string;
}

export const DotMotif: React.FC<Props> = ({brandColor, accentColor}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();

  // Progress through the video (0 to 1)
  const progress = frame / durationInFrames;

  // Phase boundaries (approximate, matching scene fracs)
  const PHASE = {
    hidden:     0.0,    // Brand reveal handles its own orb
    appear:     0.08,   // Dot appears after brand reveal
    hookCenter: 0.10,   // Center during hook
    moveCorner: 0.22,   // Move to corner during features
    features:   0.55,   // Stay in corner through features
    moveCenter: 0.60,   // Move toward center for integrations
    integrations: 0.78, // Dissolve during integrations
    closing:    0.82,   // Gone during closing
  };

  // Don't render during brand reveal (it has its own orb) or closing
  if (progress < PHASE.appear || progress > PHASE.closing) return null;

  // --- Size ---
  // Small during hook/features, slightly larger during transition to integrations
  const baseSize = interpolate(
    progress,
    [PHASE.appear, PHASE.hookCenter, PHASE.moveCorner, PHASE.features, PHASE.moveCenter, PHASE.integrations],
    [0, 12, 12, 10, 10, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Gentle pulse
  const pulse = 1 + Math.sin(frame * 0.06) * 0.08;
  const size = baseSize * pulse;

  if (size < 0.5) return null;

  // --- Position ---
  // X: center (960) during hook, then moves to left corner (120) during features, back to center for integrations
  const x = interpolate(
    progress,
    [PHASE.appear, PHASE.hookCenter, PHASE.moveCorner, PHASE.features, PHASE.moveCenter, PHASE.integrations],
    [960, 960, 120, 120, 960, 960],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Y: top-center (180) during hook, then bottom-left (900) during features, center (540) for integrations
  const y = interpolate(
    progress,
    [PHASE.appear, PHASE.hookCenter, PHASE.moveCorner, PHASE.features, PHASE.moveCenter, PHASE.integrations],
    [540, 280, 920, 920, 540, 540],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // --- Opacity ---
  const opacity = interpolate(
    progress,
    [PHASE.appear, PHASE.appear + 0.02, PHASE.integrations - 0.04, PHASE.integrations],
    [0, 0.6, 0.6, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // --- Glow ---
  const glowSize = size * 3;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          left: x - glowSize / 2,
          top: y - glowSize / 2,
          width: glowSize,
          height: glowSize,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${brandColor}18 0%, transparent 70%)`,
          opacity: opacity * 0.5,
        }}
      />
      {/* Dot */}
      <div
        style={{
          position: 'absolute',
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: brandColor,
          opacity,
          boxShadow: `0 0 ${size}px ${brandColor}40`,
        }}
      />
    </AbsoluteFill>
  );
};
