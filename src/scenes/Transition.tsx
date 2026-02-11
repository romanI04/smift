import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';

interface Props {
  type: 'fadeWhite' | 'dotExpand';
  brandColor?: string;
}

export const FadeIn: React.FC<{children: React.ReactNode; durationFrames?: number}> = ({
  children,
  durationFrames = 12,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, durationFrames], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{opacity}}>
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
    ? interpolate(frame, [startFadeAt, durationInFrames], [1, 0], {extrapolateRight: 'clamp'})
    : 1;

  return (
    <AbsoluteFill style={{opacity}}>
      {children}
    </AbsoluteFill>
  );
};

export const DotTransition: React.FC<{brandColor: string; durationInFrames: number}> = ({
  brandColor,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const mid = durationInFrames / 2;

  // Dot grows from center then shrinks
  const scale = frame < mid
    ? interpolate(frame, [0, mid], [0.05, 40], {extrapolateRight: 'clamp'})
    : interpolate(frame, [mid, durationInFrames], [40, 0.05], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          backgroundColor: brandColor,
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};
