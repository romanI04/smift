import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

interface Props {
  brandName: string;
  brandColor: string;
  tagline: string;
}

export const Wordmark: React.FC<Props> = ({brandName, brandColor, tagline}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Wordmark scales in
  const nameScale = spring({frame, fps, config: {damping: 12, stiffness: 60, mass: 1}});

  // Tagline fades in after
  const taglineOpacity = frame > 20
    ? interpolate(frame - 20, [0, 15], [0, 1], {extrapolateRight: 'clamp'})
    : 0;

  // Exit fade
  const exitOpacity = interpolate(frame, [60, 80], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, opacity: exitOpacity}}>
        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: brandColor,
            letterSpacing: '-0.04em',
            transform: `scale(${nameScale})`,
          }}
        >
          {brandName.toLowerCase()}
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 400,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#888',
            opacity: taglineOpacity,
            letterSpacing: '0.04em',
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
