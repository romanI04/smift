import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_DISPLAY, FONT_BODY} from '../fonts';

interface Props {
  brandName: string;
  brandColor: string;
  tagline: string;
}

export const Wordmark: React.FC<Props> = ({brandName, brandColor, tagline}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Name scales in with a satisfying spring
  const nameScale = spring({frame, fps, config: {damping: 10, stiffness: 50, mass: 1.2}});
  const nameOpacity = interpolate(frame, [0, 8], [0, 1], {extrapolateRight: 'clamp'});

  // Tagline slides up after name settles
  const taglineDelay = 18;
  const taglineProgress = frame > taglineDelay
    ? spring({frame: frame - taglineDelay, fps, config: {damping: 14, stiffness: 80}})
    : 0;
  const taglineY = interpolate(taglineProgress, [0, 1], [20, 0]);

  // Subtle underline accent draws in
  const lineDelay = 12;
  const lineWidth = frame > lineDelay
    ? interpolate(frame, [lineDelay, lineDelay + 20], [0, 180], {extrapolateRight: 'clamp'})
    : 0;

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20}}>
        <div
          style={{
            fontSize: 100,
            fontWeight: 800,
            fontFamily: FONT_DISPLAY,
            color: brandColor,
            letterSpacing: '-0.04em',
            transform: `scale(${nameScale})`,
            opacity: nameOpacity,
          }}
        >
          {brandName.toLowerCase()}
        </div>

        {/* Accent line */}
        <div
          style={{
            width: lineWidth,
            height: 3,
            backgroundColor: brandColor,
            borderRadius: 2,
            opacity: 0.3,
            marginTop: -8,
          }}
        />

        <div
          style={{
            fontSize: 24,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            color: '#888',
            opacity: taglineProgress,
            transform: `translateY(${taglineY}px)`,
            letterSpacing: '0.04em',
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
