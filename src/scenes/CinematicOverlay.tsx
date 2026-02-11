import {AbsoluteFill, useCurrentFrame} from 'remotion';

/**
 * Wraps a composition with film grain, vignette, and subtle color grading.
 * Stack on TOP of all other content (renders as overlay layers).
 */

export const CinematicOverlay: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      {children}

      {/* Color grade: slight contrast bump + gentle warmth */}
      <AbsoluteFill
        style={{
          filter: 'contrast(1.06) saturate(0.92) brightness(0.98)',
          mixBlendMode: 'normal',
          pointerEvents: 'none',
        }}
      />

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Film grain (animated) */}
      <AbsoluteFill style={{mixBlendMode: 'overlay', opacity: 0.06, pointerEvents: 'none'}}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <filter id="grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.7"
              numOctaves="3"
              stitchTiles="stitch"
              seed={frame % 60}
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
