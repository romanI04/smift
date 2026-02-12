import {AbsoluteFill, useCurrentFrame} from 'remotion';

/**
 * Wraps a composition with film grain, vignette, and color grading.
 * The color grade is applied to the CHILDREN container, not an empty overlay.
 */

export const CinematicOverlay: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      {/* Children with color grading applied */}
      <AbsoluteFill
        style={{
          filter: 'contrast(1.04) saturate(1.06) brightness(0.99)',
        }}
      >
        {children}
      </AbsoluteFill>

      {/* Vignette — soft, centered */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.22) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Film grain (animated) */}
      <AbsoluteFill style={{mixBlendMode: 'overlay', opacity: 0.04, pointerEvents: 'none'}}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <filter id="grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.65"
              numOctaves="4"
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
