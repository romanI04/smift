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
  const nameOpacity = interpolate(frame, [0, 6], [0, 1], {extrapolateRight: 'clamp'});

  // Tagline slides up after name settles
  const taglineDelay = 16;
  const taglineProgress = frame > taglineDelay
    ? spring({frame: frame - taglineDelay, fps, config: {damping: 14, stiffness: 80}})
    : 0;
  const taglineY = interpolate(taglineProgress, [0, 1], [16, 0]);

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28}}>
        {/* Brand name — large and bold */}
        <div
          style={{
            fontSize: 120,
            fontWeight: 900,
            fontFamily: FONT_DISPLAY,
            color: brandColor,
            letterSpacing: '-0.05em',
            transform: `scale(${nameScale})`,
            opacity: nameOpacity,
          }}
        >
          {brandName}
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            color: '#777',
            opacity: taglineProgress,
            transform: `translateY(${taglineY}px)`,
            letterSpacing: '0.03em',
          }}
        >
          {tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
