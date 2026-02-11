import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

interface Props {
  brandName: string;
  brandColor: string;
  accentColor: string;
}

export const BrandReveal: React.FC<Props> = ({brandName, brandColor, accentColor}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Circle scale: starts small, grows, then shrinks to dot
  const circleScale = spring({
    frame,
    fps,
    config: {damping: 12, stiffness: 80, mass: 0.8},
  });

  // Color cycling through gradients (simulating the HDRI orb)
  const hue = interpolate(frame, [0, 90], [200, 360]);
  const saturation = interpolate(frame, [0, 45, 90], [60, 80, 60]);
  const lightness = interpolate(frame, [0, 30, 60, 90], [50, 60, 40, 55]);

  // Circle shrinks to dot at the end
  const shrinkStart = 70;
  const shrinkScale = frame > shrinkStart
    ? interpolate(frame, [shrinkStart, 90], [1, 0.08], {extrapolateRight: 'clamp'})
    : 1;

  const circleSize = 300 * circleScale * shrinkScale;

  // Opacity fade for the gradient
  const gradientOpacity = interpolate(frame, [75, 90], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Solid black dot appears
  const dotOpacity = interpolate(frame, [75, 85], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* Gradient orb */}
      <div
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%,
            hsl(${hue + 40}, ${saturation}%, ${lightness + 20}%),
            hsl(${hue}, ${saturation}%, ${lightness}%),
            hsl(${hue - 30}, ${saturation + 10}%, ${lightness - 15}%))`,
          opacity: gradientOpacity,
          position: 'absolute',
          boxShadow: `0 0 ${circleSize * 0.3}px hsl(${hue}, ${saturation}%, ${lightness}%, 0.3)`,
        }}
      />
      {/* Solid black dot */}
      <div
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: '50%',
          backgroundColor: brandColor,
          opacity: dotOpacity,
          position: 'absolute',
        }}
      />
    </AbsoluteFill>
  );
};
