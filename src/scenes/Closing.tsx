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

  // Phase 1: Blue ring pulse (0-50)
  const ring1Scale = spring({frame, fps, config: {damping: 6, stiffness: 30, mass: 2}});
  const ring1Opacity = interpolate(frame, [0, 15, 45], [0, 0.5, 0], {extrapolateRight: 'clamp'});

  const ring2Scale = frame > 8
    ? spring({frame: frame - 8, fps, config: {damping: 6, stiffness: 30, mass: 2}})
    : 0;
  const ring2Opacity = interpolate(frame, [8, 25, 55], [0, 0.3, 0], {extrapolateRight: 'clamp'});

  // Phase 2: Neumorphic ghost VO logo (30-80)
  const ghostStart = 30;
  const ghostProgress = frame > ghostStart
    ? spring({frame: frame - ghostStart, fps, config: {damping: 14, stiffness: 40, mass: 1.5}})
    : 0;
  const ghostOpacity = frame > ghostStart
    ? interpolate(frame, [ghostStart, 50, 80], [0, 0.15, 0], {extrapolateRight: 'clamp'})
    : 0;

  // Phase 3: Wordmark entrance (70-170)
  const wmStart = 70;
  const wmScale = frame > wmStart
    ? spring({frame: frame - wmStart, fps, config: {damping: 12, stiffness: 60, mass: 1}})
    : 0;

  // Phase 4: URL fades in (120+)
  const urlStart = 120;
  const urlOpacity = frame > urlStart
    ? spring({frame: frame - urlStart, fps, config: {damping: 20, stiffness: 60}})
    : 0;

  // Phase 5: Subtle breathing pulse on wordmark (170+)
  const breathe = frame > 170
    ? 1 + Math.sin((frame - 170) * 0.04) * 0.008
    : 1;

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* Ring pulses */}
      <div
        style={{
          position: 'absolute',
          width: 600 * ring1Scale,
          height: 600 * ring1Scale,
          borderRadius: '50%',
          border: `2px solid ${accentColor}`,
          opacity: ring1Opacity,
          boxShadow: `0 0 120px ${accentColor}30, inset 0 0 60px ${accentColor}10`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 400 * ring2Scale,
          height: 400 * ring2Scale,
          borderRadius: '50%',
          border: `1.5px solid ${accentColor}`,
          opacity: ring2Opacity,
          boxShadow: `0 0 80px ${accentColor}20`,
        }}
      />

      {/* Neumorphic ghost brand mark */}
      <div
        style={{
          position: 'absolute',
          opacity: ghostOpacity,
          transform: `scale(${0.8 + ghostProgress * 0.2})`,
          fontSize: 160,
          fontWeight: 900,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: 'transparent',
          letterSpacing: '-0.04em',
          textShadow: '6px 6px 16px rgba(0,0,0,0.06), -4px -4px 12px rgba(255,255,255,0.9)',
          WebkitTextStroke: `2px #e8e8e8`,
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
          gap: 24,
        }}
      >
        <div
          style={{
            fontSize: 110,
            fontWeight: 800,
            fontFamily: FONT_DISPLAY,
            color: brandColor,
            letterSpacing: '-0.04em',
            transform: `scale(${wmScale * breathe})`,
            opacity: wmScale,
          }}
        >
          {brandName.toLowerCase()}
        </div>

        {/* URL */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            color: '#999',
            opacity: urlOpacity,
            transform: `translateY(${(1 - urlOpacity) * 10}px)`,
            letterSpacing: '0.03em',
          }}
        >
          {ctaUrl}
        </div>
      </div>
    </AbsoluteFill>
  );
};
