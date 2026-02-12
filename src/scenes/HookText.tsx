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
  const {fps} = useVideoConfig();

  const lines = [
    {text: line1, startFrame: 6, color: brandColor},
    {text: line2, startFrame: 36, color: brandColor},
    {text: keyword, startFrame: 66, color: accentColor, isKeyword: true},
  ];

  // Dot motif appears with first line
  const dotProgress = spring({frame: Math.max(0, frame - 2), fps, config: {damping: 10, stiffness: 50, mass: 1.2}});

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16}}>
        {lines.map((line, i) => {
          const lineFrame = frame - line.startFrame;
          if (lineFrame < 0) return <div key={i} style={{height: 110}} />;

          const slideUp = spring({
            frame: lineFrame,
            fps,
            config: {damping: 12, stiffness: 70, mass: 0.7},
          });

          const translateY = interpolate(slideUp, [0, 1], [30, 0]);

          return (
            <div
              key={i}
              style={{
                transform: `translateY(${translateY}px)`,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: 110,
                gap: 18,
              }}
            >
              {/* Dot motif on first line */}
              {i === 0 && (
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    backgroundColor: brandColor,
                    opacity: dotProgress,
                    transform: `scale(${dotProgress})`,
                    flexShrink: 0,
                  }}
                />
              )}

              {line.text.split('').map((char, j) => {
                const charDelay = j * 1.0;
                const charFrame = lineFrame - charDelay;

                const colorProgress = interpolate(charFrame, [0, 8], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                });

                const charOpacity = interpolate(charFrame, [-2, 3], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                });

                // Per-character scale bounce
                const charScale = charFrame > 0
                  ? interpolate(charFrame, [0, 3, 6], [0.92, 1.01, 1], {extrapolateRight: 'clamp'})
                  : 0.92;

                // Keyword gets accent color immediately. Others transition from gray to brand color.
                const charColor = line.isKeyword
                  ? accentColor
                  : colorProgress < 0.5
                    ? '#999'
                    : brandColor;

                const isSpace = char === ' ';

                return (
                  <span
                    key={j}
                    style={{
                      fontSize: 100,
                      fontWeight: 800,
                      fontFamily: FONT_DISPLAY,
                      color: charColor,
                      opacity: charOpacity,
                      letterSpacing: '-0.04em',
                      display: 'inline-block',
                      minWidth: isSpace ? '0.28em' : undefined,
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
