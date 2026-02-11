import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {easeOutCubic, smoothValue} from '../easing';

// Scale + fade entrance — feels more intentional than pure opacity
export const FadeIn: React.FC<{children: React.ReactNode; durationFrames?: number}> = ({
  children,
  durationFrames = 14,
}) => {
  const frame = useCurrentFrame();
  const opacity = smoothValue(frame, 0, durationFrames, 0, 1, easeOutCubic);
  const scale = smoothValue(frame, 0, durationFrames, 0.97, 1, easeOutCubic);

  return (
    <AbsoluteFill style={{opacity, transform: `scale(${scale})`}}>
      {children}
    </AbsoluteFill>
  );
};

export const FadeOut: React.FC<{children: React.ReactNode; durationInFrames: number; startFadeAt: number}> = ({
  children,
  durationInFrames,
  startFadeAt,
}) => {
  const frame = useCurrentFrame();
  const opacity = frame >= startFadeAt
    ? smoothValue(frame, startFadeAt, durationInFrames, 1, 0, easeOutCubic)
    : 1;

  return (
    <AbsoluteFill style={{opacity}}>
      {children}
    </AbsoluteFill>
  );
};
