import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

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
    {text: line1, startFrame: 0},
    {text: line2, startFrame: 30},
    {text: keyword, startFrame: 60, isKeyword: true},
  ];

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* Small black dot (brand motif) */}
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: brandColor,
          position: 'absolute',
          top: '46%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          opacity: interpolate(frame, [0, 10], [0, 1], {extrapolateRight: 'clamp'}),
        }}
      />

      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8}}>
        {lines.map((line, i) => {
          const lineFrame = frame - line.startFrame;
          if (lineFrame < 0) return null;

          const slideUp = spring({
            frame: lineFrame,
            fps,
            config: {damping: 15, stiffness: 120, mass: 0.5},
          });

          const translateY = interpolate(slideUp, [0, 1], [40, 0]);
          const opacity = interpolate(lineFrame, [0, 8], [0, 1], {extrapolateRight: 'clamp'});

          // Per-character color reveal for non-keyword lines
          const chars = line.text.split('');

          return (
            <div
              key={i}
              style={{
                transform: `translateY(${translateY}px)`,
                opacity,
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              {chars.map((char, j) => {
                const charDelay = j * 1.2;
                const charFrame = lineFrame - charDelay;
                const charColor = line.isKeyword
                  ? accentColor
                  : charFrame > 5
                    ? brandColor
                    : interpolate(charFrame, [0, 5], [0.4, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) > 0.7
                      ? brandColor
                      : '#999';

                return (
                  <span
                    key={j}
                    style={{
                      fontSize: 72,
                      fontWeight: 600,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      color: charColor,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {char}
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
