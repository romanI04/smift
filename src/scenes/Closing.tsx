import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_DISPLAY, FONT_BODY} from '../fonts';

interface Props {
  brandName: string;
  brandColor: string;
  accentColor: string;
  ctaUrl: string;
}

export const Closing: React.FC<Props> = ({brandName, brandColor, accentColor, ctaUrl}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Phase 1: Neumorphic ghost brand mark (0-60)
  const ghostProgress = spring({frame, fps, config: {damping: 14, stiffness: 40, mass: 1.5}});
  const ghostOpacity = interpolate(frame, [0, 20, 55, 70], [0, 0.2, 0.2, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Phase 2: Wordmark entrance (50-120)
  const wmStart = 50;
  const wmScale = frame > wmStart
    ? spring({frame: frame - wmStart, fps, config: {damping: 12, stiffness: 60, mass: 1}})
    : 0;

  // Phase 3: URL fades in (100+)
  const urlStart = 100;
  const urlOpacity = frame > urlStart
    ? spring({frame: frame - urlStart, fps, config: {damping: 20, stiffness: 60}})
    : 0;

  // Phase 4: Subtle breathing pulse on wordmark (140+)
  const breathe = frame > 140
    ? 1 + Math.sin((frame - 140) * 0.04) * 0.006
    : 1;

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      {/* Background radial glow */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          background: `radial-gradient(circle at 50% 50%, ${accentColor}06 0%, transparent 50%)`,
          opacity: wmScale,
        }}
      />

      {/* Neumorphic ghost brand mark */}
      <div
        style={{
          position: 'absolute',
          opacity: ghostOpacity,
          transform: `scale(${0.8 + ghostProgress * 0.2})`,
          fontSize: 200,
          fontWeight: 900,
          fontFamily: FONT_DISPLAY,
          color: 'transparent',
          letterSpacing: '-0.04em',
          textShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9)',
          WebkitTextStroke: `2px #e0e0e0`,
        }}
      >
        {brandName.slice(0, 2).toUpperCase()}
      </div>

      {/* Main wordmark */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
        }}
      >
        <div
          style={{
            fontSize: 130,
            fontWeight: 900,
            fontFamily: FONT_DISPLAY,
            color: brandColor,
            letterSpacing: '-0.05em',
            transform: `scale(${wmScale * breathe})`,
            opacity: wmScale,
          }}
        >
          {brandName}
        </div>

        {/* URL */}
        <div
          style={{
            fontSize: 28,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            color: '#888',
            opacity: urlOpacity,
            transform: `translateY(${(1 - urlOpacity) * 10}px)`,
            letterSpacing: '0.02em',
          }}
        >
          {ctaUrl}
        </div>
      </div>
    </AbsoluteFill>
  );
};
