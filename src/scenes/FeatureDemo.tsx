import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Feature} from '../types';
import {FONT_BODY, FONT_DISPLAY} from '../fonts';
import {getTypingChars, smoothNoise, smoothValue, easeOutExpo, easeOutCubic} from '../easing';

interface Props {
  feature: Feature;
  brandColor: string;
  accentColor: string;
}

// Shared mockup card style
const cardStyle = {
  width: 660,
  borderRadius: 14,
  overflow: 'hidden' as const,
  boxShadow: '0 8px 40px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)',
  border: '1px solid rgba(0,0,0,0.06)',
  fontFamily: 'inherit',
};

// --- UI Mockups ---

const EmailMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n');
  const subject = splitLines[0] || '';
  const body = splitLines.slice(1).join('\n');

  return (
    <div style={{...cardStyle, backgroundColor: 'white'}}>
      <div style={{padding: '14px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 14, color: '#444', fontWeight: 500, fontFamily: FONT_BODY}}>New message</span>
        <div style={{display: 'flex', gap: 12}}>
          <span style={{fontSize: 13, color: '#aaa'}}>↗</span>
          <span style={{fontSize: 13, color: '#aaa'}}>✕</span>
        </div>
      </div>
      <div style={{padding: '10px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8}}>
        <span style={{fontSize: 13, color: '#999', fontFamily: FONT_BODY}}>To</span>
        <div style={{backgroundColor: `${accentColor}12`, borderRadius: 4, padding: '3px 10px'}}>
          <span style={{fontSize: 13, color: accentColor, fontFamily: FONT_BODY}}>team@company.com</span>
        </div>
      </div>
      <div style={{padding: '12px 20px', borderBottom: '1px solid #f0f0f0'}}>
        <span style={{fontSize: 16, fontWeight: 600, color: '#111', fontFamily: FONT_BODY}}>{subject}</span>
      </div>
      <div style={{padding: '16px 20px', minHeight: 140}}>
        <span style={{fontSize: 14, lineHeight: 1.7, color: '#333', whiteSpace: 'pre-wrap', fontFamily: FONT_BODY}}>{body}</span>
      </div>
      <div style={{padding: '12px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end'}}>
        <div style={{backgroundColor: accentColor, borderRadius: 8, padding: '8px 20px'}}>
          <span style={{fontSize: 13, color: 'white', fontWeight: 500, fontFamily: FONT_BODY}}>Send</span>
        </div>
      </div>
    </div>
  );
};

const CodeMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);

  return (
    <div style={{...cardStyle, backgroundColor: '#1a1b26'}}>
      <div style={{padding: '10px 16px', backgroundColor: '#16161e', display: 'flex', alignItems: 'center', gap: 8}}>
        <div style={{display: 'flex', gap: 6}}>
          <div style={{width: 12, height: 12, borderRadius: 6, backgroundColor: '#ff5f56'}} />
          <div style={{width: 12, height: 12, borderRadius: 6, backgroundColor: '#ffbd2e'}} />
          <div style={{width: 12, height: 12, borderRadius: 6, backgroundColor: '#27c93f'}} />
        </div>
        <div style={{marginLeft: 12, backgroundColor: '#1a1b26', borderRadius: '6px 6px 0 0', padding: '4px 14px'}}>
          <span style={{fontSize: 12, color: '#a9b1d6', fontFamily: '"SF Mono", "Fira Code", monospace'}}>main.ts</span>
        </div>
      </div>
      <div style={{padding: '16px 20px', minHeight: 180}}>
        <span style={{fontSize: 13, lineHeight: 1.9, color: '#c0caf5', whiteSpace: 'pre-wrap', fontFamily: '"SF Mono", "Fira Code", monospace'}}>
          {visibleText}
        </span>
        {charsToShow < allText.length && (
          <span style={{color: accentColor, opacity: 0.8}}>▊</span>
        )}
      </div>
      <div style={{padding: '6px 16px', backgroundColor: accentColor, display: 'flex', justifyContent: 'space-between'}}>
        <span style={{fontSize: 11, color: 'white', fontFamily: FONT_BODY}}>TypeScript</span>
        <span style={{fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: FONT_BODY}}>UTF-8</span>
      </div>
    </div>
  );
};

const AnalyticsMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n').filter(l => l.trim());

  return (
    <div style={{...cardStyle, backgroundColor: 'white'}}>
      <div style={{padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 15, fontWeight: 600, color: '#111', fontFamily: FONT_DISPLAY}}>Dashboard</span>
        <div style={{padding: '4px 12px', backgroundColor: '#f5f5f5', borderRadius: 6}}>
          <span style={{fontSize: 12, color: '#666', fontFamily: FONT_BODY}}>Last 30 days</span>
        </div>
      </div>
      <div style={{padding: '14px 20px', display: 'flex', gap: 12}}>
        {[
          {label: 'Active', value: '2,847', change: '+12%', color: '#22C55E'},
          {label: 'Revenue', value: '$48.2k', change: '+8%', color: '#22C55E'},
          {label: 'Issues', value: '23', change: '-15%', color: accentColor},
        ].map(({label, value, change, color}, i) => (
          <div key={i} style={{flex: 1, padding: '12px 14px', backgroundColor: '#FAFAFA', borderRadius: 10}}>
            <span style={{fontSize: 11, color: '#888', display: 'block', fontFamily: FONT_BODY}}>{label}</span>
            <span style={{fontSize: 22, fontWeight: 700, color: '#111', display: 'block', marginTop: 2, fontFamily: FONT_DISPLAY}}>{value}</span>
            <span style={{fontSize: 11, color, fontWeight: 500, fontFamily: FONT_BODY}}>{change}</span>
          </div>
        ))}
      </div>
      <div style={{padding: '8px 20px 16px'}}>
        {splitLines.map((line, i) => (
          <div key={i} style={{padding: '10px 0', borderBottom: i < splitLines.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'flex', alignItems: 'center', gap: 10}}>
            <div style={{width: 8, height: 8, borderRadius: 4, backgroundColor: i === 0 ? accentColor : i === 1 ? '#22C55E' : '#F59E0B'}} />
            <span style={{fontSize: 13, color: '#333', fontFamily: FONT_BODY}}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ChatMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);

  return (
    <div style={{...cardStyle, backgroundColor: 'white'}}>
      <div style={{padding: '14px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{width: 32, height: 32, borderRadius: 16, backgroundColor: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <span style={{fontSize: 14, color: 'white', fontWeight: 600, fontFamily: FONT_BODY}}>T</span>
        </div>
        <div>
          <span style={{fontSize: 14, fontWeight: 600, color: '#111', display: 'block', fontFamily: FONT_BODY}}>Team Chat</span>
          <span style={{fontSize: 11, color: '#22C55E', fontFamily: FONT_BODY}}>● Online</span>
        </div>
      </div>
      <div style={{padding: '16px 20px 8px', display: 'flex', gap: 8}}>
        <div style={{width: 28, height: 28, borderRadius: 14, backgroundColor: '#E5E5E5', flexShrink: 0}} />
        <div style={{backgroundColor: '#F5F5F5', borderRadius: '4px 14px 14px 14px', padding: '10px 14px', maxWidth: 400}}>
          <span style={{fontSize: 13, color: '#555', fontFamily: FONT_BODY}}>Hey! Can you help with the project timeline?</span>
        </div>
      </div>
      <div style={{padding: '8px 20px 16px', display: 'flex', justifyContent: 'flex-end'}}>
        <div style={{backgroundColor: accentColor, borderRadius: '14px 4px 14px 14px', padding: '10px 14px', maxWidth: 420}}>
          <span style={{fontSize: 13, color: 'white', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: FONT_BODY}}>{visibleText}</span>
          {charsToShow < allText.length && (
            <span style={{color: 'rgba(255,255,255,0.5)'}}>▊</span>
          )}
        </div>
      </div>
      <div style={{padding: '12px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{flex: 1, padding: '8px 14px', backgroundColor: '#f5f5f5', borderRadius: 20}}>
          <span style={{fontSize: 13, color: '#bbb', fontFamily: FONT_BODY}}>Type a message...</span>
        </div>
      </div>
    </div>
  );
};

const CalendarMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n').filter(l => l.trim());
  const hours = ['9 AM', '10 AM', '11 AM', '12 PM', '1 PM'];

  return (
    <div style={{...cardStyle, backgroundColor: 'white'}}>
      <div style={{padding: '14px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 16, fontWeight: 600, color: '#111', fontFamily: FONT_DISPLAY}}>February 2026</span>
        <div style={{padding: '4px 12px', backgroundColor: accentColor, borderRadius: 6}}>
          <span style={{fontSize: 12, color: 'white', fontWeight: 500, fontFamily: FONT_BODY}}>Today</span>
        </div>
      </div>
      <div style={{padding: '8px 0'}}>
        {hours.map((hour, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'stretch', minHeight: 36}}>
            <div style={{width: 60, padding: '4px 12px 0 0', textAlign: 'right'}}>
              <span style={{fontSize: 11, color: '#888', fontFamily: FONT_BODY}}>{hour}</span>
            </div>
            <div style={{flex: 1, borderTop: '1px solid #f0f0f0', padding: '2px 8px'}}>
              {i === 1 && splitLines.length > 0 && (
                <div style={{backgroundColor: `${accentColor}15`, borderLeft: `3px solid ${accentColor}`, borderRadius: '0 6px 6px 0', padding: '6px 10px'}}>
                  <span style={{fontSize: 12, color: accentColor, fontWeight: 500, fontFamily: FONT_BODY}}>{splitLines[0]}</span>
                </div>
              )}
              {i === 3 && splitLines.length > 1 && (
                <div style={{backgroundColor: '#F59E0B15', borderLeft: '3px solid #F59E0B', borderRadius: '0 6px 6px 0', padding: '6px 10px'}}>
                  <span style={{fontSize: 12, color: '#B45309', fontWeight: 500, fontFamily: FONT_BODY}}>{splitLines[1]}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const GenericMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n').filter(l => l.trim());

  return (
    <div style={{...cardStyle, backgroundColor: 'white'}}>
      <div style={{padding: '18px 24px', borderBottom: '1px solid #eee'}}>
        <span style={{fontSize: 16, fontWeight: 600, color: '#111', fontFamily: FONT_DISPLAY}}>{splitLines[0] || ''}</span>
      </div>
      <div style={{padding: '16px 24px'}}>
        {splitLines.slice(1).map((line, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0'}}>
            <div style={{width: 6, height: 6, borderRadius: 3, backgroundColor: accentColor, marginTop: 6, flexShrink: 0}} />
            <span style={{fontSize: 14, color: '#444', lineHeight: 1.6, fontFamily: FONT_BODY}}>{line}</span>
          </div>
        ))}
      </div>
      <div style={{padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end'}}>
        <div style={{padding: '8px 20px', backgroundColor: accentColor, borderRadius: 8}}>
          <span style={{fontSize: 13, color: 'white', fontWeight: 500, fontFamily: FONT_BODY}}>Continue</span>
        </div>
      </div>
    </div>
  );
};

const MOCKUP_MAP: Record<string, React.FC<{lines: string[]; charsToShow: number; accentColor: string}>> = {
  mail: EmailMockup,
  code: CodeMockup,
  analytics: AnalyticsMockup,
  chat: ChatMockup,
  calendar: CalendarMockup,
  generic: GenericMockup,
};

// --- Audio Bars ---
const AudioBars: React.FC<{frame: number; active: boolean}> = ({frame, active}) => {
  const barConfigs = [
    {baseHeight: 0.3, width: 3.5},
    {baseHeight: 0.55, width: 4.5},
    {baseHeight: 1.0, width: 5.5},
    {baseHeight: 0.45, width: 4.5},
    {baseHeight: 0.75, width: 4.5},
    {baseHeight: 0.35, width: 3.5},
  ];

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 2.5, height: 32}}>
      {barConfigs.map(({baseHeight, width}, i) => {
        const noise = smoothNoise(frame, i);
        const h = active ? Math.max(3, baseHeight * noise * 32) : 3;
        return (
          <div
            key={i}
            style={{
              width,
              height: h,
              backgroundColor: 'rgba(255,255,255,0.9)',
              borderRadius: width / 2,
            }}
          />
        );
      })}
    </div>
  );
};

// --- Icon in pill ---
const PillIcon: React.FC<{icon: string; accentColor: string}> = ({icon, accentColor}) => {
  const s = {width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center'} as const;
  const icons: Record<string, React.ReactNode> = {
    mail: <div style={{...s, backgroundColor: '#4285f4'}}><span style={{fontSize: 11, color: 'white'}}>✉</span></div>,
    code: <div style={{...s, backgroundColor: '#007ACC'}}><span style={{fontSize: 12, color: 'white', fontFamily: 'monospace', fontWeight: 700}}>&lt;/&gt;</span></div>,
    analytics: <div style={{...s, backgroundColor: '#22C55E'}}><span style={{fontSize: 12, color: 'white'}}>◈</span></div>,
    chat: <div style={{...s, backgroundColor: '#8B5CF6'}}><span style={{fontSize: 12, color: 'white'}}>◉</span></div>,
    calendar: <div style={{...s, backgroundColor: '#EF4444'}}><span style={{fontSize: 12, color: 'white', fontWeight: 700, fontFamily: FONT_BODY}}>10</span></div>,
    generic: <div style={{...s, backgroundColor: accentColor}}><span style={{fontSize: 12, color: 'white'}}>◆</span></div>,
  };
  return <>{icons[icon] || <div style={{...s, backgroundColor: accentColor}}><span style={{fontSize: 12, color: 'white'}}>●</span></div>}</>;
};

// --- Main Component ---
export const FeatureDemo: React.FC<Props> = ({feature, brandColor, accentColor}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Pill enters — expo ease (slow start, confident snap)
  const pillProgress = smoothValue(frame, 0, 20, 0, 1, easeOutExpo);
  const pillY = interpolate(pillProgress, [0, 1], [30, 0]);

  // Card enters — slides up from below with spring
  const cardProgress = smoothValue(frame, 6, 30, 0, 1, easeOutCubic);
  const cardY = interpolate(cardProgress, [0, 1], [50, 0]);
  const cardScale = interpolate(cardProgress, [0, 1], [0.92, 1]);

  // Variable-speed typing
  const typeStart = 28;
  const allText = feature.demoLines.join('\n');
  const charsToShow = getTypingChars(frame, typeStart, allText);
  const typingDone = charsToShow >= allText.length;

  // Caption appears at fixed time
  const captionShowFrame = Math.min(durationInFrames * 0.7, 130);
  const captionOpacity = smoothValue(frame, captionShowFrame, captionShowFrame + 18, 0, 1, easeOutCubic);

  // Subtle card float during typing
  const cardFloat = typingDone ? 0 : Math.sin(frame * 0.04) * 1.5;

  const Mockup = MOCKUP_MAP[feature.icon] || GenericMockup;

  return (
    <AbsoluteFill style={{backgroundColor: '#FAFAFA', justifyContent: 'center', alignItems: 'center'}}>
      {/* Card */}
      <div
        style={{
          position: 'absolute',
          top: '7%',
          transform: `scale(${cardScale}) translateY(${cardY + cardFloat}px)`,
          opacity: cardProgress,
          transformOrigin: 'center bottom',
        }}
      >
        <Mockup lines={feature.demoLines} charsToShow={charsToShow} accentColor={accentColor} />
      </div>

      {/* Dynamic Island Pill */}
      <div
        style={{
          position: 'absolute',
          bottom: '11%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backgroundColor: brandColor,
          borderRadius: 50,
          padding: '10px 22px',
          transform: `translateY(${pillY}px)`,
          opacity: pillProgress,
          boxShadow: `0 4px 20px ${brandColor}30`,
        }}
      >
        <PillIcon icon={feature.icon} accentColor={accentColor} />
        <AudioBars frame={frame} active={!typingDone && frame > typeStart} />

        {/* Caption slides in */}
        {captionOpacity > 0.01 && (
          <span
            style={{
              color: 'white',
              fontSize: 16,
              fontWeight: 500,
              fontFamily: FONT_BODY,
              marginLeft: 2,
              opacity: captionOpacity,
              transform: `translateX(${(1 - captionOpacity) * 12}px)`,
            }}
          >
            {feature.caption}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};
