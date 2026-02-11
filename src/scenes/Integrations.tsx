import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

interface Props {
  integrations: string[];
  brandColor: string;
  accentColor: string;
  brandName: string;
}

export const Integrations: React.FC<Props> = ({integrations, brandColor, accentColor, brandName}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const radius = 380;
  const iconCount = integrations.length;

  // Rotate the whole ring
  const rotation = interpolate(frame, [0, 300], [0, 360]);

  // Text reveal
  const text1Opacity = spring({frame, fps, config: {damping: 20, stiffness: 80}});
  const text2Start = 40;
  const text2Opacity = frame > text2Start
    ? spring({frame: frame - text2Start, fps, config: {damping: 20, stiffness: 80}})
    : 0;

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* Icon ring */}
      <div
        style={{
          position: 'absolute',
          width: radius * 2,
          height: radius * 2,
          transform: `rotate(${rotation}deg)`,
        }}
      >
        {integrations.map((name, i) => {
          const angle = (i / iconCount) * 360;
          const x = radius + radius * Math.cos((angle * Math.PI) / 180) - 30;
          const y = radius + radius * Math.sin((angle * Math.PI) / 180) - 30;

          const entryDelay = i * 3;
          const iconScale = frame > entryDelay
            ? spring({frame: frame - entryDelay, fps, config: {damping: 12, stiffness: 100}})
            : 0;

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: 60,
                height: 60,
                backgroundColor: '#f5f5f5',
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'system-ui',
                color: '#333',
                transform: `scale(${iconScale}) rotate(-${rotation}deg)`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                border: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              {name.slice(0, 2)}
            </div>
          );
        })}
      </div>

      {/* Center text */}
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, zIndex: 1}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          {/* Brand pill */}
          <div
            style={{
              backgroundColor: brandColor,
              borderRadius: 20,
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{color: 'white', fontSize: 16, fontWeight: 700, fontFamily: 'system-ui'}}>
              {brandName.slice(0, 2).toUpperCase()}
            </span>
          </div>

          <span
            style={{
              fontSize: 48,
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              opacity: text1Opacity,
              letterSpacing: '-0.02em',
            }}
          >
            <span style={{color: accentColor}}>works</span>{' '}
            <span style={{color: brandColor}}>across all apps</span>
          </span>
        </div>

        <span
          style={{
            fontSize: 42,
            fontWeight: 600,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            opacity: text2Opacity,
            letterSpacing: '-0.02em',
          }}
        >
          <span style={{color: accentColor}}>with</span>{' '}
          <span style={{color: brandColor}}>zero setup</span>{' '}
          <span style={{color: accentColor}}>required</span>
        </span>
      </div>
    </AbsoluteFill>
  );
};
