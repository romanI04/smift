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
  const orbSize = 300;

  // Rotating highlight position (simulates 3D rotation)
  const highlightAngle = interpolate(frame, [0, 100], [0, 720]);
  const highlightX = 38 + Math.cos((highlightAngle * Math.PI) / 180) * 14;
  const highlightY = 32 + Math.sin((highlightAngle * Math.PI) / 180) * 10;

  // Richer color cycling — pastel sky/cloud palette like the reference HDRI sphere
  const hue1 = interpolate(frame, [0, 25, 50, 75, 100], [220, 280, 320, 200, 240]);
  const hue2 = interpolate(frame, [0, 25, 50, 75, 100], [340, 220, 260, 300, 200]);
  const sat = interpolate(frame, [0, 50, 100], [45, 55, 40]);
  const light = interpolate(frame, [0, 25, 50, 75, 100], [72, 68, 75, 65, 70]);

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

  // Background glow
  const bgGlowOpacity = interpolate(frame, [0, 20, 70, 100], [0, 0.12, 0.08, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      {/* Large background glow */}
      <div
        style={{
          position: 'absolute',
          width: '120%',
          height: '120%',
          background: `radial-gradient(circle at 50% 50%, hsl(${hue1}, 35%, 88%) 0%, transparent 45%)`,
          opacity: bgGlowOpacity,
        }}
      />

      {/* Ambient glow halo around orb */}
      <div
        style={{
          position: 'absolute',
          width: currentSize * 3.5,
          height: currentSize * 3.5,
          borderRadius: '50%',
          background: `radial-gradient(circle, hsl(${hue1}, 40%, 85%, 0.15) 0%, transparent 60%)`,
          opacity: gradientOpacity * 0.8,
          filter: 'blur(20px)',
        }}
      />

      {/* Main gradient orb — multiple layered gradients for depth */}
      <div
        style={{
          width: currentSize,
          height: currentSize,
          borderRadius: '50%',
          position: 'absolute',
          opacity: gradientOpacity,
          background: `
            radial-gradient(circle at ${highlightX}% ${highlightY}%,
              hsl(${hue1 + 30}, ${sat + 15}%, ${light + 18}%) 0%,
              hsl(${hue1}, ${sat + 10}%, ${light + 8}%) 20%,
              hsl(${hue2}, ${sat}%, ${light}%) 45%,
              hsl(${hue2 - 20}, ${sat - 5}%, ${light - 10}%) 70%,
              hsl(${hue2 - 40}, ${sat - 10}%, ${light - 18}%) 100%)`,
          boxShadow: `
            inset -${currentSize * 0.1}px -${currentSize * 0.06}px ${currentSize * 0.25}px hsl(${hue2}, 30%, ${light - 20}%, 0.5),
            inset ${currentSize * 0.08}px ${currentSize * 0.05}px ${currentSize * 0.2}px hsl(${hue1}, 50%, ${light + 15}%, 0.4),
            0 ${currentSize * 0.08}px ${currentSize * 0.35}px hsl(${hue2}, 35%, 50%, 0.25),
            0 0 ${currentSize * 0.6}px hsl(${hue1}, 30%, 80%, 0.1)`,
        }}
      />

      {/* Secondary gradient overlay for cloud-like depth */}
      <div
        style={{
          width: currentSize,
          height: currentSize,
          borderRadius: '50%',
          position: 'absolute',
          opacity: gradientOpacity * 0.4,
          background: `
            radial-gradient(ellipse at ${70 - highlightX * 0.3}% ${60 - highlightY * 0.3}%,
              hsl(${hue2 + 60}, 40%, 85%, 0.6) 0%,
              transparent 50%)`,
        }}
      />

      {/* Specular highlight — glassy reflection */}
      <div
        style={{
          position: 'absolute',
          width: currentSize * 0.4,
          height: currentSize * 0.28,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.2) 40%, transparent 70%)',
          opacity: gradientOpacity * 0.9,
          transform: `translate(${-currentSize * 0.1}px, ${-currentSize * 0.16}px) rotate(-15deg)`,
        }}
      />

      {/* Edge light rim — subtle bright edge on the light side */}
      <div
        style={{
          width: currentSize,
          height: currentSize,
          borderRadius: '50%',
          position: 'absolute',
          opacity: gradientOpacity * 0.3,
          background: `
            radial-gradient(circle at ${highlightX + 10}% ${highlightY - 5}%,
              rgba(255,255,255,0.3) 0%,
              transparent 25%)`,
        }}
      />

      {/* Solid brand-color dot (appears as orb flattens) */}
      <div
        style={{
          width: currentSize,
          height: currentSize,
          borderRadius: '50%',
          backgroundColor: brandColor,
          position: 'absolute',
          opacity: blackOpacity,
          boxShadow: blackOpacity > 0.5 ? `0 0 ${currentSize * 0.6}px ${brandColor}25` : 'none',
        }}
      />
    </AbsoluteFill>
  );
};
