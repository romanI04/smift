import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Feature} from '../types';
import {getTypingChars, smoothNoise, smoothValue, easeOutExpo, easeOutCubic} from '../easing';

interface Props {
  feature: Feature;
  brandColor: string;
  accentColor: string;
}

// --- UI Mockups ---

const EmailMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines,
  charsToShow,
  accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n');
  const subject = splitLines[0] || '';
  const body = splitLines.slice(1).join('\n');

  return (
    <div
      style={{
        width: 640,
        backgroundColor: 'white',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 0 40px rgba(37,99,235,0.10), 0 1px 4px rgba(0,0,0,0.08)',
        border: '1px solid rgba(37,99,235,0.12)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{padding: '14px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 14, color: '#444', fontWeight: 500}}>New message</span>
        <div style={{display: 'flex', gap: 12}}>
          <span style={{fontSize: 13, color: '#888'}}>↗</span>
          <span style={{fontSize: 13, color: '#888'}}>✕</span>
        </div>
      </div>

      {/* To field */}
      <div style={{padding: '10px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8}}>
        <span style={{fontSize: 13, color: '#888'}}>To</span>
        <div style={{backgroundColor: '#EEF4FF', borderRadius: 4, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 4}}>
          <div style={{width: 16, height: 16, borderRadius: 3, backgroundColor: accentColor, opacity: 0.3}} />
          <span style={{fontSize: 13, color: accentColor}}>Emily@voiceos.com</span>
        </div>
      </div>

      {/* Subject */}
      <div style={{padding: '12px 20px', borderBottom: '1px solid #f0f0f0'}}>
        <span style={{fontSize: 16, fontWeight: 600, color: '#111'}}>{subject}</span>
      </div>

      {/* Body */}
      <div style={{padding: '16px 20px', minHeight: 140}}>
        <span style={{fontSize: 14, lineHeight: 1.7, color: '#333', whiteSpace: 'pre-wrap'}}>{body}</span>
      </div>

      {/* Footer */}
      <div style={{padding: '12px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <span style={{fontSize: 13, color: '#888'}}>📎 Attach a file</span>
        </div>
        <div style={{backgroundColor: '#4285f4', borderRadius: 6, padding: '6px 16px'}}>
          <span style={{fontSize: 13, color: 'white', fontWeight: 500}}>Send email</span>
        </div>
      </div>
    </div>
  );
};

const ClaudeMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines,
  charsToShow,
  accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);

  return (
    <div
      style={{
        width: 640,
        backgroundColor: '#FAF9F6',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 0 40px rgba(37,99,235,0.10), 0 1px 4px rgba(0,0,0,0.08)',
        border: '1px solid rgba(37,99,235,0.12)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{padding: '30px 32px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8}}>
        <span style={{fontSize: 22, color: '#C4704B'}}>✳</span>
        <span style={{fontSize: 24, fontWeight: 500, color: '#333', fontFamily: 'Georgia, serif'}}>Evening, Jerry</span>
      </div>

      {/* Input area */}
      <div style={{padding: '0 32px 24px'}}>
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: 10,
            border: '1px solid #ddd',
            padding: '14px 16px',
            minHeight: 100,
          }}
        >
          <span style={{fontSize: 14, lineHeight: 1.7, color: '#333', whiteSpace: 'pre-wrap'}}>
            {visibleText || <span style={{color: '#aaa'}}>How can I help you today?</span>}
          </span>

          {/* Bottom bar */}
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16}}>
            <div style={{display: 'flex', gap: 10}}>
              <span style={{fontSize: 16, color: '#aaa'}}>+</span>
              <span style={{fontSize: 14, color: '#aaa'}}>⏱</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <span style={{fontSize: 12, color: '#888'}}>Sonnet 4.5</span>
              <span style={{fontSize: 11, color: '#aaa'}}>∨</span>
              <div style={{width: 28, height: 28, borderRadius: 6, backgroundColor: '#E8C4B8', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                <span style={{fontSize: 14, color: 'white'}}>↑</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const TwitterMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines,
  charsToShow,
  accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);

  return (
    <div
      style={{
        width: 640,
        backgroundColor: 'white',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 0 40px rgba(37,99,235,0.10), 0 1px 4px rgba(0,0,0,0.08)',
        border: '1px solid rgba(37,99,235,0.12)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 16, color: '#888'}}>✕</span>
        <span style={{fontSize: 14, color: accentColor, fontWeight: 500}}>Drafts</span>
      </div>

      {/* Original tweet */}
      <div style={{padding: '0 20px 12px', display: 'flex', gap: 10}}>
        <div style={{width: 36, height: 36, borderRadius: 18, backgroundColor: '#E0F0F0'}} />
        <div>
          <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
            <span style={{fontSize: 13, fontWeight: 600, color: '#111'}}>@motion_shia_</span>
            <span style={{fontSize: 12, color: '#888'}}>· Jan 3</span>
          </div>
          <span style={{fontSize: 13, color: '#555'}}>#100 pic.x.com/4BxAWOThmv</span>
        </div>
      </div>

      {/* Reply indicator */}
      <div style={{padding: '0 20px 12px 66px'}}>
        <span style={{fontSize: 13, color: '#888'}}>Replying to </span>
        <span style={{fontSize: 13, color: accentColor}}>@motion_shia_</span>
      </div>

      {/* Reply content */}
      <div style={{padding: '8px 20px 16px', display: 'flex', gap: 10}}>
        <div style={{width: 36, height: 36, borderRadius: 18, backgroundColor: '#D0D8FF'}} />
        <span style={{fontSize: 16, color: '#111', lineHeight: 1.5, flex: 1}}>{visibleText}</span>
      </div>

      {/* Footer */}
      <div style={{padding: '12px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <div style={{display: 'flex', gap: 14}}>
          {['🖼', 'GIF', '📊', '😊', '📍'].map((icon, i) => (
            <span key={i} style={{fontSize: 14, color: accentColor}}>{icon}</span>
          ))}
        </div>
        <div style={{backgroundColor: '#ccc', borderRadius: 20, padding: '6px 18px'}}>
          <span style={{fontSize: 14, color: 'white', fontWeight: 600}}>Reply</span>
        </div>
      </div>
    </div>
  );
};

const MOCKUP_MAP: Record<string, React.FC<{lines: string[]; charsToShow: number; accentColor: string}>> = {
  mail: EmailMockup,
  ai: ClaudeMockup,
  social: TwitterMockup,
};

// --- Audio Bars (organic, fluid) ---
const AudioBars: React.FC<{frame: number; active: boolean}> = ({frame, active}) => {
  const barConfigs = [
    {baseHeight: 0.3, width: 4},
    {baseHeight: 0.55, width: 5},
    {baseHeight: 1.0, width: 6},
    {baseHeight: 0.45, width: 5},
    {baseHeight: 0.75, width: 5},
    {baseHeight: 0.35, width: 4},
  ];

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 3, height: 36}}>
      {barConfigs.map(({baseHeight, width}, i) => {
        const noise = smoothNoise(frame, i);
        const targetH = active ? baseHeight * noise * 36 : 4;
        // Smooth the height change
        const h = Math.max(4, targetH);

        return (
          <div
            key={i}
            style={{
              width,
              height: h,
              backgroundColor: 'rgba(255,255,255,0.95)',
              borderRadius: width / 2,
            }}
          />
        );
      })}
    </div>
  );
};

// --- Icon in pill ---
const PillIcon: React.FC<{icon: string}> = ({icon}) => {
  const icons: Record<string, React.ReactNode> = {
    mail: (
      <div style={{width: 26, height: 20, borderRadius: 4, backgroundColor: '#4285f4', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <span style={{fontSize: 12, color: 'white'}}>✉</span>
      </div>
    ),
    ai: <span style={{fontSize: 20, color: '#C4704B'}}>✳</span>,
    social: <span style={{fontSize: 18, color: 'white', fontWeight: 800, fontFamily: 'system-ui'}}>𝕏</span>,
  };
  return <>{icons[icon] || <span style={{fontSize: 18, color: 'white'}}>●</span>}</>;
};

// --- Main Component ---
export const FeatureDemo: React.FC<Props> = ({feature, brandColor, accentColor}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Pill enters with expo ease (slow start, confident snap)
  const pillScale = smoothValue(frame, 0, 18, 0, 1, easeOutExpo);

  // Card expands with cubic ease (gentle, not bouncy)
  const cardExpand = smoothValue(frame, 12, 35, 0, 1, easeOutCubic);

  // Variable-speed typing (pauses at punctuation, faster on common chars)
  const typeStart = 28;
  const allText = feature.demoLines.join('\n');
  const charsToShow = getTypingChars(frame, typeStart, allText);
  const typingDone = charsToShow >= allText.length;

  // Caption appears at a fixed time (or when typing is mostly done)
  const captionShowFrame = 125;
  const captionOpacity = smoothValue(frame, captionShowFrame, captionShowFrame + 20, 0, 1, easeOutCubic);

  // Exit: exponential ease-out for smooth departure
  const exitStart = 165;
  const exitProgress = smoothValue(frame, exitStart, 198, 0, 1, easeOutExpo);

  // Card slight float during typing (subtle Y movement)
  const cardFloat = typingDone ? 0 : Math.sin(frame * 0.05) * 2;

  const Mockup = MOCKUP_MAP[feature.icon] || EmailMockup;

  return (
    <AbsoluteFill style={{backgroundColor: 'white', justifyContent: 'center', alignItems: 'center'}}>
      {/* UI Card Mockup */}
      <div
        style={{
          position: 'absolute',
          top: '8%',
          transform: `scale(${0.88 + cardExpand * 0.12}) translateY(${cardFloat + (1 - cardExpand) * 15}px)`,
          opacity: cardExpand * (1 - exitProgress),
          transformOrigin: 'center bottom',
        }}
      >
        <Mockup lines={feature.demoLines} charsToShow={charsToShow} accentColor={accentColor} />
      </div>

      {/* Dynamic Island Pill */}
      <div
        style={{
          position: 'absolute',
          bottom: '12%',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          backgroundColor: brandColor,
          borderRadius: 50,
          padding: '12px 24px',
          transform: `scale(${pillScale * (1 - exitProgress * 0.3)})`,
          opacity: 1 - exitProgress,
        }}
      >
        <PillIcon icon={feature.icon} />
        <AudioBars frame={frame} active={!typingDone && frame > typeStart} />

        {/* Caption slides in */}
        {captionOpacity > 0.01 && (
          <span
            style={{
              color: 'white',
              fontSize: 18,
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              marginLeft: 4,
              opacity: captionOpacity,
              transform: `translateX(${(1 - captionOpacity) * 15}px)`,
            }}
          >
            {feature.caption}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};
