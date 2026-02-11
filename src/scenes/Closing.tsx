import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

interface Props {
  brandName: string;
  brandColor: string;
  accentColor: string;
  ctaUrl: string;
}

export const Closing: React.FC<Props> = ({brandName, brandColor, accentColor, ctaUrl}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Blue ring flash
  const ringScale = spring({
    frame,
    fps,
    config: {damping: 8, stiffness: 60, mass: 1.2},
  });
  const ringOpacity = interpolate(frame, [0, 20, 40], [0, 0.6, 0], {extrapolateRight: 'clamp'});

  // Neumorphic logo ghost
  const ghostOpacity = interpolate(frame, [20, 40, 60], [0, 0.3, 0], {extrapolateRight: 'clamp'});

  // Wordmark entrance
  const wordmarkStart = 50;
  const wordmarkScale = frame > wordmarkStart
    ? spring({frame: frame - wordmarkStart, fps, config: {damping: 14, stiffness: 90}})
    : 0;

  // URL text
  const urlStart = 80;
  const urlOpacity = frame > urlStart
    ? interpolate(frame - urlStart, [0, 20], [0, 1], {extrapolateRight: 'clamp'})
    : 0;

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* Blue ring flash */}
      <div
        style={{
          position: 'absolute',
          width: 500 * ringScale,
          height: 500 * ringScale,
          borderRadius: '50%',
          border: `3px solid ${accentColor}`,
          opacity: ringOpacity,
          boxShadow: `0 0 80px ${accentColor}40`,
        }}
      />

      {/* Neumorphic ghost text */}
      <div
        style={{
          position: 'absolute',
          fontSize: 180,
          fontWeight: 800,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: 'transparent',
          textShadow: '4px 4px 8px rgba(0,0,0,0.06), -2px -2px 6px rgba(255,255,255,0.8)',
          WebkitTextStroke: '1px rgba(0,0,0,0.04)',
          opacity: ghostOpacity,
          letterSpacing: '-0.04em',
        }}
      >
        {brandName.slice(0, 2).toUpperCase()}
      </div>

      {/* Main wordmark */}
      <div
        style={{
          fontSize: 120,
          fontWeight: 800,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: brandColor,
          transform: `scale(${wordmarkScale})`,
          letterSpacing: '-0.04em',
        }}
      >
        {brandName.toLowerCase()}
      </div>

      {/* URL */}
      <div
        style={{
          position: 'absolute',
          bottom: '18%',
          fontSize: 28,
          fontWeight: 400,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#666',
          opacity: urlOpacity,
          letterSpacing: '0.02em',
        }}
      >
        {ctaUrl}
      </div>
    </AbsoluteFill>
  );
};
