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

const CodeMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
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
        backgroundColor: '#1E1E1E',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 0 40px rgba(37,99,235,0.10), 0 1px 4px rgba(0,0,0,0.3)',
        border: '1px solid rgba(37,99,235,0.12)',
        fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
      }}
    >
      {/* Tab bar */}
      <div style={{padding: '8px 16px', backgroundColor: '#252526', display: 'flex', alignItems: 'center', gap: 8}}>
        <div style={{display: 'flex', gap: 6}}>
          <div style={{width: 12, height: 12, borderRadius: 6, backgroundColor: '#FF5F56'}} />
          <div style={{width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFBD2E'}} />
          <div style={{width: 12, height: 12, borderRadius: 6, backgroundColor: '#27C93F'}} />
        </div>
        <div style={{marginLeft: 12, backgroundColor: '#1E1E1E', borderRadius: '6px 6px 0 0', padding: '4px 14px'}}>
          <span style={{fontSize: 12, color: '#ccc'}}>workflow.ts</span>
        </div>
        <div style={{padding: '4px 14px'}}>
          <span style={{fontSize: 12, color: '#666'}}>config.yml</span>
        </div>
      </div>

      {/* Code area */}
      <div style={{padding: '16px 20px', minHeight: 160}}>
        <span style={{fontSize: 13, lineHeight: 1.8, color: '#D4D4D4', whiteSpace: 'pre-wrap'}}>
          {visibleText}
        </span>
        {charsToShow < allText.length && (
          <span style={{color: accentColor, opacity: 0.8}}>▊</span>
        )}
      </div>

      {/* Status bar */}
      <div style={{padding: '6px 16px', backgroundColor: accentColor, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 11, color: 'white'}}>TypeScript</span>
        <span style={{fontSize: 11, color: 'rgba(255,255,255,0.7)'}}>UTF-8 · LF</span>
      </div>
    </div>
  );
};

const AnalyticsMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines,
  charsToShow,
  accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n').filter(l => l.trim());

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
      <div style={{padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 15, fontWeight: 600, color: '#111'}}>Dashboard</span>
        <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <div style={{padding: '4px 12px', backgroundColor: '#f5f5f5', borderRadius: 6}}>
            <span style={{fontSize: 12, color: '#666'}}>Last 30 days</span>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div style={{padding: '14px 20px', display: 'flex', gap: 12}}>
        {[
          {label: 'Active', value: '2,847', change: '+12%', color: '#22C55E'},
          {label: 'Revenue', value: '$48.2k', change: '+8%', color: '#22C55E'},
          {label: 'Issues', value: '23', change: '-15%', color: accentColor},
        ].map(({label, value, change, color}, i) => (
          <div key={i} style={{flex: 1, padding: '12px 14px', backgroundColor: '#FAFAFA', borderRadius: 8}}>
            <span style={{fontSize: 11, color: '#888', display: 'block'}}>{label}</span>
            <span style={{fontSize: 20, fontWeight: 700, color: '#111', display: 'block', marginTop: 2}}>{value}</span>
            <span style={{fontSize: 11, color, fontWeight: 500}}>{change}</span>
          </div>
        ))}
      </div>

      {/* Content area (typed lines appear as list items) */}
      <div style={{padding: '8px 20px 16px'}}>
        {splitLines.map((line, i) => (
          <div key={i} style={{padding: '10px 0', borderBottom: i < splitLines.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'flex', alignItems: 'center', gap: 10}}>
            <div style={{width: 8, height: 8, borderRadius: 4, backgroundColor: i === 0 ? accentColor : i === 1 ? '#22C55E' : '#F59E0B'}} />
            <span style={{fontSize: 13, color: '#333'}}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ChatMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
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
      <div style={{padding: '14px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{width: 32, height: 32, borderRadius: 16, backgroundColor: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <span style={{fontSize: 14, color: 'white', fontWeight: 600}}>S</span>
        </div>
        <div>
          <span style={{fontSize: 14, fontWeight: 600, color: '#111', display: 'block'}}>Support</span>
          <span style={{fontSize: 11, color: '#22C55E'}}>● Online</span>
        </div>
      </div>

      {/* Previous message (from other person) */}
      <div style={{padding: '16px 20px 8px', display: 'flex', gap: 8}}>
        <div style={{width: 28, height: 28, borderRadius: 14, backgroundColor: '#E5E5E5', flexShrink: 0}} />
        <div style={{backgroundColor: '#F5F5F5', borderRadius: '4px 12px 12px 12px', padding: '10px 14px', maxWidth: 400}}>
          <span style={{fontSize: 13, color: '#555'}}>Hey! I had a question about the project timeline. Can you help?</span>
        </div>
      </div>

      {/* Our reply (typing) */}
      <div style={{padding: '8px 20px 16px', display: 'flex', justifyContent: 'flex-end'}}>
        <div style={{backgroundColor: accentColor, borderRadius: '12px 4px 12px 12px', padding: '10px 14px', maxWidth: 420}}>
          <span style={{fontSize: 13, color: 'white', whiteSpace: 'pre-wrap', lineHeight: 1.6}}>{visibleText}</span>
          {charsToShow < allText.length && (
            <span style={{color: 'rgba(255,255,255,0.6)'}}>▊</span>
          )}
        </div>
      </div>

      {/* Input area */}
      <div style={{padding: '12px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10}}>
        <span style={{fontSize: 16, color: '#aaa'}}>+</span>
        <div style={{flex: 1, padding: '8px 12px', backgroundColor: '#f5f5f5', borderRadius: 20}}>
          <span style={{fontSize: 13, color: '#aaa'}}>Type a message...</span>
        </div>
        <span style={{fontSize: 16, color: accentColor}}>➤</span>
      </div>
    </div>
  );
};

const CalendarMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines,
  charsToShow,
  accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n').filter(l => l.trim());

  const hours = ['9 AM', '10 AM', '11 AM', '12 PM', '1 PM'];

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
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <span style={{fontSize: 16, fontWeight: 600, color: '#111'}}>February 2026</span>
          <div style={{display: 'flex', gap: 4}}>
            <span style={{fontSize: 14, color: '#888'}}>‹</span>
            <span style={{fontSize: 14, color: '#888'}}>›</span>
          </div>
        </div>
        <div style={{padding: '4px 12px', backgroundColor: accentColor, borderRadius: 6}}>
          <span style={{fontSize: 12, color: 'white', fontWeight: 500}}>Today</span>
        </div>
      </div>

      {/* Time grid */}
      <div style={{padding: '8px 0'}}>
        {hours.map((hour, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'stretch', minHeight: 36}}>
            <div style={{width: 60, padding: '4px 12px 0 0', textAlign: 'right'}}>
              <span style={{fontSize: 11, color: '#888'}}>{hour}</span>
            </div>
            <div style={{flex: 1, borderTop: '1px solid #f0f0f0', position: 'relative', padding: '2px 8px'}}>
              {/* Show typed event in the 10 AM slot */}
              {i === 1 && splitLines.length > 0 && (
                <div style={{backgroundColor: `${accentColor}15`, borderLeft: `3px solid ${accentColor}`, borderRadius: '0 6px 6px 0', padding: '6px 10px'}}>
                  <span style={{fontSize: 12, color: accentColor, fontWeight: 500}}>{splitLines[0]}</span>
                </div>
              )}
              {i === 3 && splitLines.length > 1 && (
                <div style={{backgroundColor: '#F59E0B15', borderLeft: '3px solid #F59E0B', borderRadius: '0 6px 6px 0', padding: '6px 10px'}}>
                  <span style={{fontSize: 12, color: '#B45309', fontWeight: 500}}>{splitLines[1]}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom note */}
      {splitLines.length > 2 && (
        <div style={{padding: '8px 20px 14px'}}>
          <span style={{fontSize: 12, color: '#888'}}>{splitLines.slice(2).join(' · ')}</span>
        </div>
      )}
    </div>
  );
};

const GenericMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines,
  charsToShow,
  accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);
  const splitLines = visibleText.split('\n').filter(l => l.trim());

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
      <div style={{padding: '18px 24px', borderBottom: '1px solid #eee'}}>
        <span style={{fontSize: 16, fontWeight: 600, color: '#111'}}>{splitLines[0] || ''}</span>
      </div>

      {/* Content */}
      <div style={{padding: '16px 24px'}}>
        {splitLines.slice(1).map((line, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0'}}>
            <div style={{width: 6, height: 6, borderRadius: 3, backgroundColor: accentColor, marginTop: 6, flexShrink: 0}} />
            <span style={{fontSize: 14, color: '#444', lineHeight: 1.6}}>{line}</span>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div style={{padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end'}}>
        <div style={{padding: '6px 18px', backgroundColor: accentColor, borderRadius: 6}}>
          <span style={{fontSize: 13, color: 'white', fontWeight: 500}}>Continue</span>
        </div>
      </div>
    </div>
  );
};

const MOCKUP_MAP: Record<string, React.FC<{lines: string[]; charsToShow: number; accentColor: string}>> = {
  mail: EmailMockup,
  ai: ClaudeMockup,
  social: TwitterMockup,
  code: CodeMockup,
  analytics: AnalyticsMockup,
  chat: ChatMockup,
  calendar: CalendarMockup,
  generic: GenericMockup,
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
  const iconStyle = {width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center'} as const;
  const icons: Record<string, React.ReactNode> = {
    mail: (
      <div style={{...iconStyle, backgroundColor: '#4285f4', borderRadius: 4, height: 20}}>
        <span style={{fontSize: 12, color: 'white'}}>✉</span>
      </div>
    ),
    ai: <span style={{fontSize: 20, color: '#C4704B'}}>✳</span>,
    social: <span style={{fontSize: 18, color: 'white', fontWeight: 800, fontFamily: 'system-ui'}}>𝕏</span>,
    code: (
      <div style={{...iconStyle, backgroundColor: '#007ACC'}}>
        <span style={{fontSize: 13, color: 'white', fontFamily: 'monospace', fontWeight: 700}}>&lt;/&gt;</span>
      </div>
    ),
    analytics: (
      <div style={{...iconStyle, backgroundColor: '#22C55E'}}>
        <span style={{fontSize: 14, color: 'white'}}>📊</span>
      </div>
    ),
    chat: (
      <div style={{...iconStyle, backgroundColor: '#8B5CF6'}}>
        <span style={{fontSize: 14, color: 'white'}}>💬</span>
      </div>
    ),
    calendar: (
      <div style={{...iconStyle, backgroundColor: '#EF4444'}}>
        <span style={{fontSize: 13, color: 'white', fontWeight: 700}}>10</span>
      </div>
    ),
    generic: (
      <div style={{...iconStyle, backgroundColor: '#6B7280'}}>
        <span style={{fontSize: 14, color: 'white'}}>◆</span>
      </div>
    ),
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

  const Mockup = MOCKUP_MAP[feature.icon] || GenericMockup;

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
