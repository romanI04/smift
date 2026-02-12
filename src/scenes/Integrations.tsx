import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_DISPLAY} from '../fonts';
import {BrandIcon} from '../icons';

interface Props {
  integrations: string[];
  brandColor: string;
  accentColor: string;
  brandName: string;
}

export const Integrations: React.FC<Props> = ({integrations, brandColor, accentColor, brandName}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const iconSize = 90;
  const iconCount = integrations.length;
  const radius = 380;

  // Slow rotation
  const rotation = interpolate(frame, [0, 900], [0, 360]);

  // Text entrance
  const text1Progress = spring({frame: Math.max(0, frame - 10), fps, config: {damping: 16, stiffness: 60}});
  const text2Start = 40;
  const text2Progress = frame > text2Start
    ? spring({frame: frame - text2Start, fps, config: {damping: 16, stiffness: 60}})
    : 0;

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      {/* Bottom gradient glow — like the reference's blue glow */}
      <div
        style={{
          position: 'absolute',
          bottom: -100,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 900,
          height: 500,
          background: `radial-gradient(ellipse at center, ${accentColor}25 0%, transparent 70%)`,
          filter: 'blur(40px)',
          opacity: interpolate(frame, [20, 60], [0, 0.8], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      />

      {/* Icon semicircle — positioned upper half */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '45%',
          width: 0,
          height: 0,
          transform: `rotate(${rotation}deg)`,
        }}
      >
        {integrations.map((name, i) => {
          // Arrange in a semicircle (top half)
          const angleSpread = Math.min(200, iconCount * 28);
          const startAngle = -90 - angleSpread / 2;
          const angle = startAngle + (i / (iconCount - 1)) * angleSpread;
          const rad = (angle * Math.PI) / 180;
          const x = radius * Math.cos(rad) - iconSize / 2;
          const y = radius * Math.sin(rad) - iconSize / 2;

          const entryDelay = i * 4;
          const iconScale = frame > entryDelay
            ? spring({frame: frame - entryDelay, fps, config: {damping: 12, stiffness: 80}})
            : 0;

          // Prismatic border effect — each icon gets a subtle gradient border
          const hue = (i / iconCount) * 360;

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
              {/* Gradient border ring */}
              <div
                style={{
                  padding: 3,
                  borderRadius: iconSize * 0.26,
                  background: `linear-gradient(${135 + hue}deg, hsl(${hue}, 70%, 85%), hsl(${hue + 60}, 70%, 85%))`,
                  boxShadow: `0 4px 24px hsla(${hue}, 50%, 60%, 0.15)`,
                }}
              >
                <BrandIcon name={name} size={iconSize} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Center text */}
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, zIndex: 1}}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            opacity: text1Progress,
            transform: `translateY(${(1 - text1Progress) * 20}px)`,
          }}
        >
          {/* Brand pill */}
          <div
            style={{
              backgroundColor: brandColor,
              borderRadius: 16,
              padding: '8px 16px',
              boxShadow: `0 2px 12px ${brandColor}30`,
            }}
          >
            <span style={{fontSize: 16, fontWeight: 800, color: 'white', fontFamily: 'system-ui'}}>
              {brandName.length <= 5 ? brandName.toUpperCase() : brandName.slice(0, 3).toUpperCase()}
            </span>
          </div>

          <span style={{fontSize: 48, fontWeight: 700, fontFamily: FONT_DISPLAY, letterSpacing: '-0.03em'}}>
            <span style={{color: accentColor}}>fits</span>{' '}
            <span style={{color: brandColor}}>where you work</span>
          </span>
        </div>

        <span
          style={{
            fontSize: 42,
            fontWeight: 600,
            fontFamily: FONT_DISPLAY,
            letterSpacing: '-0.02em',
            opacity: text2Progress,
            transform: `translateY(${(1 - text2Progress) * 15}px)`,
          }}
        >
          <span style={{color: '#222'}}>with </span>
          <span style={{color: accentColor}}>zero setup required</span>
          {/* Dot motif inline */}
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: brandColor,
              marginLeft: 12,
              verticalAlign: 'middle',
            }}
          />
        </span>
      </div>
    </AbsoluteFill>
  );
};
