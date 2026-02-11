import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

interface Props {
  brandName: string;
  brandColor: string;
  accentColor: string;
}

export const BrandReveal: React.FC<Props> = ({brandName, brandColor, accentColor}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Phase 1: Orb appears and rotates (0-60)
  // Phase 2: Orb flattens to solid dot (60-90)

  const enterScale = spring({frame, fps, config: {damping: 10, stiffness: 50, mass: 1.2}});
  const orbSize = 280;

  // Rotating highlight position (simulates 3D rotation)
  const highlightAngle = interpolate(frame, [0, 90], [0, 720]);
  const highlightX = 35 + Math.cos((highlightAngle * Math.PI) / 180) * 15;
  const highlightY = 30 + Math.sin((highlightAngle * Math.PI) / 180) * 10;

  // Color cycling (dawn → day → dusk → night)
  const hue1 = interpolate(frame, [0, 25, 50, 75, 90], [340, 200, 220, 260, 210]);
  const hue2 = interpolate(frame, [0, 25, 50, 75, 90], [30, 210, 280, 230, 220]);
  const lightness = interpolate(frame, [0, 25, 50, 75, 90], [55, 62, 48, 35, 58]);

  // Flatten to black dot
  const flattenStart = 60;
  const flattenProgress = frame > flattenStart
    ? interpolate(frame, [flattenStart, 85], [0, 1], {extrapolateRight: 'clamp'})
    : 0;

  // Dot shrink at very end
  const shrinkProgress = frame > 80
    ? interpolate(frame, [80, 90], [1, 0.06], {extrapolateRight: 'clamp'})
    : 1;

  const gradientOpacity = 1 - flattenProgress;
  const blackOpacity = flattenProgress;
  const currentSize = orbSize * enterScale * shrinkProgress;

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          width: currentSize * 2.5,
          height: currentSize * 2.5,
          borderRadius: '50%',
          background: `radial-gradient(circle, hsl(${hue1}, 50%, 80%, 0.15) 0%, transparent 70%)`,
          opacity: gradientOpacity * 0.6,
        }}
      />

      {/* Gradient orb (multi-layer for depth) */}
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
            0 ${currentSize * 0.05}px ${currentSize * 0.2}px hsl(${hue2}, 40%, 40%, 0.15)`,
        }}
      />

      {/* Specular highlight (white shine) */}
      <div
        style={{
          position: 'absolute',
          width: currentSize * 0.35,
          height: currentSize * 0.25,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.6) 0%, transparent 70%)',
          opacity: gradientOpacity * 0.8,
          transform: `translate(${-currentSize * 0.12}px, ${-currentSize * 0.15}px) rotate(-20deg)`,
        }}
      />

      {/* Solid black dot */}
      <div
        style={{
          width: currentSize,
          height: currentSize,
          borderRadius: '50%',
          backgroundColor: brandColor,
          position: 'absolute',
          opacity: blackOpacity,
        }}
      />
    </AbsoluteFill>
  );
};
