import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

interface Props {
  brandName: string;
  brandColor: string;
  accentColor: string;
}

export const BrandReveal: React.FC<Props> = ({brandName, brandColor, accentColor}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Phase 1: Orb appears and rotates (0-65)
  // Phase 2: Orb flattens to solid dot + brand text (65-100)

  const enterScale = spring({frame, fps, config: {damping: 8, stiffness: 40, mass: 1.5}});
  const orbSize = 260;

  // Rotating highlight position (simulates 3D rotation)
  const highlightAngle = interpolate(frame, [0, 100], [0, 900]);
  const highlightX = 35 + Math.cos((highlightAngle * Math.PI) / 180) * 18;
  const highlightY = 30 + Math.sin((highlightAngle * Math.PI) / 180) * 12;

  // Color cycling — richer palette
  const hue1 = interpolate(frame, [0, 25, 50, 75, 100], [340, 200, 220, 260, 210]);
  const hue2 = interpolate(frame, [0, 25, 50, 75, 100], [30, 210, 280, 230, 220]);
  const lightness = interpolate(frame, [0, 25, 50, 75, 100], [55, 62, 48, 35, 58]);

  // Flatten to brand-color dot
  const flattenStart = 60;
  const flattenProgress = frame > flattenStart
    ? interpolate(frame, [flattenStart, 85], [0, 1], {extrapolateRight: 'clamp'})
    : 0;

  // Dot shrinks at end to transition out
  const shrinkProgress = frame > 80
    ? interpolate(frame, [80, 100], [1, 0.04], {extrapolateRight: 'clamp'})
    : 1;

  const gradientOpacity = 1 - flattenProgress;
  const blackOpacity = flattenProgress;
  const currentSize = orbSize * enterScale * shrinkProgress;

  // Background: subtle radial glow that follows the orb's color
  const bgGlowOpacity = interpolate(frame, [0, 20, 70, 100], [0, 0.08, 0.06, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          background: `radial-gradient(circle at 50% 50%, hsl(${hue1}, 40%, 85%) 0%, transparent 50%)`,
          opacity: bgGlowOpacity,
        }}
      />

      {/* Ambient glow around orb */}
      <div
        style={{
          position: 'absolute',
          width: currentSize * 2.8,
          height: currentSize * 2.8,
          borderRadius: '50%',
          background: `radial-gradient(circle, hsl(${hue1}, 50%, 80%, 0.12) 0%, transparent 70%)`,
          opacity: gradientOpacity * 0.7,
        }}
      />

      {/* Gradient orb */}
      <div
        style={{
          width: currentSize,
          height: currentSize,
          borderRadius: '50%',
          position: 'absolute',
          opacity: gradientOpacity,
          background: `
            radial-gradient(circle at ${highlightX}% ${highlightY}%,
              hsl(${hue1 + 40}, 70%, ${lightness + 25}%) 0%,
              hsl(${hue1}, 65%, ${lightness + 10}%) 25%,
              hsl(${hue2}, 60%, ${lightness}%) 55%,
              hsl(${hue2 - 20}, 55%, ${lightness - 15}%) 80%,
              hsl(${hue2 - 40}, 50%, ${lightness - 25}%) 100%)`,
          boxShadow: `
            inset -${currentSize * 0.08}px -${currentSize * 0.05}px ${currentSize * 0.2}px hsl(${hue2}, 40%, ${lightness - 20}%, 0.4),
            inset ${currentSize * 0.06}px ${currentSize * 0.04}px ${currentSize * 0.15}px hsl(${hue1}, 60%, ${lightness + 20}%, 0.3),
            0 ${currentSize * 0.06}px ${currentSize * 0.25}px hsl(${hue2}, 40%, 40%, 0.2)`,
        }}
      />

      {/* Specular highlight */}
      <div
        style={{
          position: 'absolute',
          width: currentSize * 0.35,
          height: currentSize * 0.25,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.65) 0%, transparent 70%)',
          opacity: gradientOpacity * 0.85,
          transform: `translate(${-currentSize * 0.12}px, ${-currentSize * 0.15}px) rotate(-20deg)`,
        }}
      />

      {/* Solid brand-color dot */}
      <div
        style={{
          width: currentSize,
          height: currentSize,
          borderRadius: '50%',
          backgroundColor: brandColor,
          position: 'absolute',
          opacity: blackOpacity,
          boxShadow: blackOpacity > 0.5 ? `0 0 ${currentSize * 0.5}px ${brandColor}30` : 'none',
        }}
      />
    </AbsoluteFill>
  );
};
