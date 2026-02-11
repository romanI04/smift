import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_DISPLAY} from '../fonts';

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
    Jira: {bg: '#0052CC', fg: '#fff', label: 'J'},
    Trello: {bg: '#0079BF', fg: '#fff', label: 'T'},
    Asana: {bg: '#F06A6A', fg: '#fff', label: 'A'},
    Zapier: {bg: '#FF4A00', fg: '#fff', label: 'Z'},
    Sentry: {bg: '#362D59', fg: '#fff', label: 'S'},
    'Google Drive': {bg: '#fff', fg: '#4285F4', label: 'G'},
    Dropbox: {bg: '#0061FF', fg: '#fff', label: 'D'},
    Salesforce: {bg: '#00A1E0', fg: '#fff', label: 'S'},
    Stripe: {bg: '#635BFF', fg: '#fff', label: 'S'},
    Intercom: {bg: '#286EFA', fg: '#fff', label: 'I'},
    HubSpot: {bg: '#FF7A59', fg: '#fff', label: 'H'},
    Zendesk: {bg: '#03363D', fg: '#fff', label: 'Z'},
    Airtable: {bg: '#18BFFF', fg: '#fff', label: 'A'},
    Monday: {bg: '#FF3D57', fg: '#fff', label: 'M'},
    Vercel: {bg: '#000', fg: '#fff', label: '▲'},
    Netlify: {bg: '#00C7B7', fg: '#fff', label: 'N'},
    AWS: {bg: '#FF9900', fg: '#232F3E', label: 'A'},
    Discord: {bg: '#5865F2', fg: '#fff', label: 'D'},
    Zoom: {bg: '#2D8CFF', fg: '#fff', label: 'Z'},
    Loom: {bg: '#625DF5', fg: '#fff', label: 'L'},
    Miro: {bg: '#FFD02F', fg: '#050038', label: 'M'},
    ClickUp: {bg: '#7B68EE', fg: '#fff', label: 'C'},
    Webflow: {bg: '#146EF5', fg: '#fff', label: 'W'},
    Shopify: {bg: '#96BF48', fg: '#fff', label: 'S'},
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
          {/* Line 1: [brand pill] works across all apps */}
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
                {brandName.length <= 4 ? brandName.toUpperCase() : brandName.slice(0, 2).toUpperCase()}
              </span>
            </div>

            <span style={{fontSize: 44, fontWeight: 600, fontFamily: FONT_DISPLAY, letterSpacing: '-0.02em'}}>
              <span style={{color: accentColor}}>works</span>{' '}
              <span style={{color: brandColor}}>with your stack</span>
            </span>
          </div>

          {/* Line 2 */}
          <span
            style={{
              fontSize: 40,
              fontWeight: 600,
              fontFamily: FONT_DISPLAY,
              letterSpacing: '-0.02em',
              opacity: text2Progress,
              transform: `translateY(${(1 - text2Progress) * 15}px)`,
            }}
          >
            <span style={{color: brandColor}}>no migration</span>{' '}
            <span style={{color: accentColor}}>needed</span>
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
