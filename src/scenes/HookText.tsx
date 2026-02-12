import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_DISPLAY} from '../fonts';

interface Props {
  line1: string;
  line2: string;
  keyword: string;
  accentColor: string;
  brandColor: string;
}

export const HookText: React.FC<Props> = ({line1, line2, keyword, accentColor, brandColor}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const lines = [
    {text: line1, startFrame: 8, color: brandColor},
    {text: line2, startFrame: 38, color: brandColor},
    {text: keyword, startFrame: 68, color: accentColor, isKeyword: true},
  ];

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8}}>
        {lines.map((line, i) => {
          const lineFrame = frame - line.startFrame;
          if (lineFrame < 0) return <div key={i} style={{height: 85}} />;

          const slideUp = spring({
            frame: lineFrame,
            fps,
            config: {damping: 12, stiffness: 70, mass: 0.7},
          });

          const translateY = interpolate(slideUp, [0, 1], [40, 0]);

          return (
            <div
              key={i}
              style={{
                transform: `translateY(${translateY}px)`,
                display: 'flex',
                justifyContent: 'center',
                height: 85,
                alignItems: 'center',
              }}
            >
              {line.text.split('').map((char, j) => {
                const charDelay = j * 1.2;
                const charFrame = lineFrame - charDelay;

                const colorProgress = interpolate(charFrame, [0, 10], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                });

                const charOpacity = interpolate(charFrame, [-2, 4], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                });

                // Slight scale bounce per character
                const charScale = charFrame > 0
                  ? interpolate(charFrame, [0, 4, 8], [0.9, 1.02, 1], {extrapolateRight: 'clamp'})
                  : 0.9;

                const charColor = line.isKeyword
                  ? accentColor
                  : colorProgress < 0.5
                    ? '#ccc'
                    : brandColor;

                const isSpace = char === ' ';

                return (
                  <span
                    key={j}
                    style={{
                      fontSize: 78,
                      fontWeight: 700,
                      fontFamily: FONT_DISPLAY,
                      color: charColor,
                      opacity: charOpacity,
                      letterSpacing: '-0.03em',
                      display: 'inline-block',
                      minWidth: isSpace ? '0.25em' : undefined,
                      transform: `scale(${charScale})`,
                    }}
                  >
                    {isSpace ? '\u00A0' : char}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
