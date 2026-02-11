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

  // Black dot motif (persists from BrandReveal)
  const dotScale = spring({frame, fps, config: {damping: 14, stiffness: 100}});
  const dotSize = 14;

  const lines = [
    {text: line1, startFrame: 5, color: brandColor},
    {text: line2, startFrame: 35, color: brandColor},
    {text: keyword, startFrame: 65, color: accentColor, isKeyword: true},
  ];

  // Exit: everything fades
  const exitOpacity = interpolate(frame, [100, 125], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: exitOpacity}}>
        {/* Dot */}
        <div
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            backgroundColor: brandColor,
            marginBottom: 20,
            transform: `scale(${dotScale})`,
          }}
        />

        {lines.map((line, i) => {
          const lineFrame = frame - line.startFrame;
          if (lineFrame < 0) return <div key={i} style={{height: 80}} />;

          const slideUp = spring({
            frame: lineFrame,
            fps,
            config: {damping: 14, stiffness: 80, mass: 0.6},
          });

          const translateY = interpolate(slideUp, [0, 1], [30, 0]);

          return (
            <div
              key={i}
              style={{
                transform: `translateY(${translateY}px)`,
                display: 'flex',
                justifyContent: 'center',
                height: 80,
                alignItems: 'center',
              }}
            >
              {line.text.split('').map((char, j) => {
                const charDelay = j * 1.5;
                const charFrame = lineFrame - charDelay;

                // Smooth color transition per character
                const colorProgress = interpolate(charFrame, [0, 8], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                });

                const charOpacity = interpolate(charFrame, [-2, 3], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                });

                const charColor = line.isKeyword
                  ? accentColor
                  : colorProgress < 0.5
                    ? '#bbb'
                    : brandColor;

                return (
                  <span
                    key={j}
                    style={{
                      fontSize: 80,
                      fontWeight: 700,
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      color: charColor,
                      opacity: charOpacity,
                      letterSpacing: '-0.03em',
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
