import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

interface Props {
  integrations: string[];
  brandColor: string;
  accentColor: string;
  brandName: string;
}

// Styled icon with brand-appropriate colors
const AppIcon: React.FC<{name: string; size: number}> = ({name, size}) => {
  const iconStyles: Record<string, {bg: string; fg: string; label: string}> = {
    Slack: {bg: '#4A154B', fg: '#fff', label: '#'},
    Gmail: {bg: '#fff', fg: '#EA4335', label: 'M'},
    Notion: {bg: '#000', fg: '#fff', label: 'N'},
    Telegram: {bg: '#0088cc', fg: '#fff', label: '✈'},
    Canva: {bg: '#7D2AE8', fg: '#fff', label: 'C'},
    X: {bg: '#000', fg: '#fff', label: '𝕏'},
    LinkedIn: {bg: '#0A66C2', fg: '#fff', label: 'in'},
    GitHub: {bg: '#24292e', fg: '#fff', label: '⬡'},
    ChatGPT: {bg: '#10A37F', fg: '#fff', label: 'G'},
    Cursor: {bg: '#000', fg: '#fff', label: '▸'},
    Figma: {bg: '#1E1E1E', fg: '#A259FF', label: 'F'},
    Linear: {bg: '#5E6AD2', fg: '#fff', label: 'L'},
  };

  const style = iconStyles[name] || {bg: '#f0f0f0', fg: '#333', label: name[0]};

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        backgroundColor: style.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 12px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          fontSize: size * 0.42,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: style.fg,
          letterSpacing: '-0.02em',
        }}
      >
        {style.label}
      </span>
    </div>
  );
};

export const Integrations: React.FC<Props> = ({integrations, brandColor, accentColor, brandName}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const radius = 360;
  const iconSize = 64;
  const iconCount = integrations.length;

  // Slow rotation
  const rotation = interpolate(frame, [0, 600], [0, 360]);

  // Text animations
  const text1Progress = spring({frame, fps, config: {damping: 16, stiffness: 70}});

  const text2Start = 35;
  const text2Progress = frame > text2Start
    ? spring({frame: frame - text2Start, fps, config: {damping: 16, stiffness: 70}})
    : 0;

  // Exit fade
  const exitStart = 200;
  const exitOpacity = frame > exitStart
    ? interpolate(frame, [exitStart, 240], [1, 0], {extrapolateRight: 'clamp'})
    : 1;

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{opacity: exitOpacity}}>
        {/* Icon ring */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 0,
            height: 0,
            transform: `rotate(${rotation}deg)`,
          }}
        >
          {integrations.map((name, i) => {
            const angle = (i / iconCount) * 360 - 90;
            const rad = (angle * Math.PI) / 180;
            const x = radius * Math.cos(rad) - iconSize / 2;
            const y = radius * Math.sin(rad) - iconSize / 2;

            const entryDelay = i * 4;
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
                  transform: `scale(${iconScale}) rotate(-${rotation}deg)`,
                }}
              >
                <AppIcon name={name} size={iconSize} />
              </div>
            );
          })}
        </div>

        {/* Center text block */}
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, zIndex: 1}}>
          {/* Line 1: [VO pill] works across all apps */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              opacity: text1Progress,
              transform: `translateY(${(1 - text1Progress) * 20}px)`,
            }}
          >
            <div
              style={{
                backgroundColor: brandColor,
                borderRadius: 14,
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span style={{fontSize: 15, fontWeight: 800, color: 'white', fontFamily: 'system-ui'}}>
                VO
              </span>
            </div>

            <span style={{fontSize: 44, fontWeight: 600, fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.02em'}}>
              <span style={{color: accentColor}}>works</span>{' '}
              <span style={{color: brandColor}}>across all apps</span>
            </span>
          </div>

          {/* Line 2: with zero setup required */}
          <span
            style={{
              fontSize: 40,
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              letterSpacing: '-0.02em',
              opacity: text2Progress,
              transform: `translateY(${(1 - text2Progress) * 15}px)`,
            }}
          >
            <span style={{color: brandColor}}>with zero setup</span>{' '}
            <span style={{color: accentColor}}>required</span>
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
