import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Feature} from '../types';
import {FONT_BODY, FONT_DISPLAY} from '../fonts';
import {getTypingChars, smoothNoise, smoothValue, easeOutExpo, easeOutCubic} from '../easing';

interface Props {
  feature: Feature;
  brandColor: string;
  accentColor: string;
  domainPackId?: string;
}

// Card style with signature blue glow (like reference's "powered by voice" glow)
const makeCardStyle = (accentColor: string, surface = 'white') => ({
  width: 680,
  borderRadius: 16,
  overflow: 'hidden' as const,
  boxShadow: `0 8px 40px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06), 0 0 80px ${accentColor}12, 0 0 160px ${accentColor}08`,
  border: '1px solid rgba(0,0,0,0.06)',
  backgroundColor: surface,
  fontFamily: 'inherit',
});

type VisualLayout = 'default' | 'terminal' | 'commerce' | 'ledger' | 'leaderboard' | 'timeline' | 'feed';

interface DomainVisualTheme {
  id: string;
  layout: VisualLayout;
  canvasGradient: string;
  cardSurface: string;
  cardHeaderSurface: string;
  pillBackground: string;
  glowColor: string;
}

const DEFAULT_VISUAL_THEME: DomainVisualTheme = {
  id: 'general',
  layout: 'default',
  canvasGradient: 'radial-gradient(circle at 20% 20%, #f4f7ff 0%, #fafafa 45%, #f8f8f8 100%)',
  cardSurface: 'white',
  cardHeaderSurface: '#FAFAFA',
  pillBackground: '#111111',
  glowColor: '#2563EB',
};

const DOMAIN_VISUAL_THEMES: Record<string, DomainVisualTheme> = {
  'b2b-saas': {
    id: 'b2b-saas',
    layout: 'default',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #eaf4ff 0%, #f7fbff 42%, #f6f8fb 100%)',
    cardSurface: 'white',
    cardHeaderSurface: '#F5F8FC',
    pillBackground: '#1D4ED8',
    glowColor: '#2563EB',
  },
  devtools: {
    id: 'devtools',
    layout: 'terminal',
    canvasGradient: 'radial-gradient(circle at 18% 16%, #e9edf8 0%, #f4f6fb 45%, #f6f7fb 100%)',
    cardSurface: '#111827',
    cardHeaderSurface: '#0B1220',
    pillBackground: '#0F172A',
    glowColor: '#3B82F6',
  },
  'ecommerce-retail': {
    id: 'ecommerce-retail',
    layout: 'commerce',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #fff3e2 0%, #fff8ef 42%, #f9f7f3 100%)',
    cardSurface: '#FFFCF7',
    cardHeaderSurface: '#FFF2DF',
    pillBackground: '#D97706',
    glowColor: '#F59E0B',
  },
  fintech: {
    id: 'fintech',
    layout: 'ledger',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #edf7f2 0%, #f6fbf8 45%, #f7f8f8 100%)',
    cardSurface: '#FCFFFD',
    cardHeaderSurface: '#EDF7F2',
    pillBackground: '#166534',
    glowColor: '#22C55E',
  },
  gaming: {
    id: 'gaming',
    layout: 'leaderboard',
    canvasGradient: 'radial-gradient(circle at 20% 20%, #f0ebff 0%, #f7f3ff 45%, #f8f8fb 100%)',
    cardSurface: '#FCFAFF',
    cardHeaderSurface: '#F2ECFF',
    pillBackground: '#7C3AED',
    glowColor: '#8B5CF6',
  },
  'media-creator': {
    id: 'media-creator',
    layout: 'feed',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #ffeef2 0%, #fff6f8 45%, #faf7f8 100%)',
    cardSurface: '#FFFCFD',
    cardHeaderSurface: '#FFEFF4',
    pillBackground: '#BE185D',
    glowColor: '#EC4899',
  },
  education: {
    id: 'education',
    layout: 'timeline',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #eef8ff 0%, #f6fbff 45%, #f8fafb 100%)',
    cardSurface: '#FBFEFF',
    cardHeaderSurface: '#EAF6FF',
    pillBackground: '#0369A1',
    glowColor: '#0EA5E9',
  },
  'real-estate': {
    id: 'real-estate',
    layout: 'commerce',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #f7f2eb 0%, #faf7f2 45%, #f8f8f6 100%)',
    cardSurface: '#FFFEFC',
    cardHeaderSurface: '#F4ECE0',
    pillBackground: '#92400E',
    glowColor: '#D97706',
  },
  'travel-hospitality': {
    id: 'travel-hospitality',
    layout: 'timeline',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #e8f6ff 0%, #f2fbff 45%, #f5f8fa 100%)',
    cardSurface: '#FCFEFF',
    cardHeaderSurface: '#E7F4FB',
    pillBackground: '#0E7490',
    glowColor: '#06B6D4',
  },
  'logistics-ops': {
    id: 'logistics-ops',
    layout: 'ledger',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #eef2f5 0%, #f5f8fa 45%, #f7f9fa 100%)',
    cardSurface: '#FCFDFE',
    cardHeaderSurface: '#EBF0F4',
    pillBackground: '#334155',
    glowColor: '#64748B',
  },
  'social-community': {
    id: 'social-community',
    layout: 'feed',
    canvasGradient: 'radial-gradient(circle at 15% 15%, #eef2ff 0%, #f5f7ff 45%, #f8f8fb 100%)',
    cardSurface: '#FDFDFF',
    cardHeaderSurface: '#EDF1FF',
    pillBackground: '#4338CA',
    glowColor: '#6366F1',
  },
  general: DEFAULT_VISUAL_THEME,
};

function getVisualTheme(domainPackId?: string): DomainVisualTheme {
  if (!domainPackId) return DEFAULT_VISUAL_THEME;
  return DOMAIN_VISUAL_THEMES[domainPackId] ?? DEFAULT_VISUAL_THEME;
}

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
    <div style={{...makeCardStyle(accentColor), backgroundColor: 'white'}}>
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
    <div style={{...makeCardStyle(accentColor), backgroundColor: '#1a1b26'}}>
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
  const splitLines = visibleText.split('\n').map((line) => line.trim()).filter(Boolean);
  const {title, periodLabel, metrics, detailLines} = buildAnalyticsContent(splitLines, accentColor);

  return (
    <div style={{...makeCardStyle(accentColor), backgroundColor: 'white'}}>
      <div style={{padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 15, fontWeight: 600, color: '#111', fontFamily: FONT_DISPLAY}}>{title}</span>
        <div style={{padding: '4px 12px', backgroundColor: '#f5f5f5', borderRadius: 6}}>
          <span style={{fontSize: 12, color: '#666', fontFamily: FONT_BODY}}>{periodLabel}</span>
        </div>
      </div>
      <div style={{padding: '14px 20px', display: 'flex', gap: 12}}>
        {metrics.map(({label, value, change, color}, i) => (
          <div key={i} style={{flex: 1, padding: '12px 14px', backgroundColor: '#FAFAFA', borderRadius: 10}}>
            <span style={{fontSize: 11, color: '#888', display: 'block', fontFamily: FONT_BODY}}>{label}</span>
            <span style={{fontSize: 22, fontWeight: 700, color: '#111', display: 'block', marginTop: 2, fontFamily: FONT_DISPLAY}}>{value}</span>
            <span style={{fontSize: 11, color, fontWeight: 500, fontFamily: FONT_BODY}}>{change}</span>
          </div>
        ))}
      </div>
      <div style={{padding: '8px 20px 16px'}}>
        {detailLines.map((line, i) => (
          <div key={i} style={{padding: '10px 0', borderBottom: i < detailLines.length - 1 ? '1px solid #f0f0f0' : 'none', display: 'flex', alignItems: 'center', gap: 10}}>
            <div style={{width: 8, height: 8, borderRadius: 4, backgroundColor: i === 0 ? accentColor : i === 1 ? '#22C55E' : '#F59E0B'}} />
            <span style={{fontSize: 13, color: '#333', fontFamily: FONT_BODY}}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

function buildAnalyticsContent(lines: string[], accentColor: string): {
  title: string;
  periodLabel: string;
  metrics: Array<{label: string; value: string; change: string; color: string}>;
  detailLines: string[];
} {
  const metrics: Array<{label: string; value: string; change: string; color: string}> = [];
  const detailLines: string[] = [];

  for (const line of lines) {
    if (metrics.length < 3) {
      const parsed = parseMetricLine(line, metrics.length, accentColor);
      if (parsed) {
        metrics.push(parsed);
        continue;
      }
    }
    detailLines.push(line);
  }

  while (metrics.length < 3) {
    const idx = metrics.length;
    metrics.push({
      label: ['Signal', 'Trend', 'Focus'][idx] || `Metric ${idx + 1}`,
      value: ['Live', 'Stable', 'Up'][idx] || 'Ready',
      change: idx === 2 ? '-2%' : `+${4 + idx}%`,
      color: idx === 2 ? accentColor : '#22C55E',
    });
  }

  const title = pickTitle(detailLines, lines);
  const periodLabel = pickPeriod(lines);
  const normalizedDetails = detailLines.length > 0 ? detailLines.slice(0, 4) : ['Track key updates and act quickly.'];

  return {title, periodLabel, metrics, detailLines: normalizedDetails};
}

function parseMetricLine(
  line: string,
  index: number,
  accentColor: string,
): {label: string; value: string; change: string; color: string} | null {
  const colon = line.match(/^([A-Za-z][A-Za-z0-9\s/-]{1,24}):\s*(.+)$/);
  if (colon) {
    const label = toLabel(colon[1]);
    const value = colon[2].trim();
    const up = !/down|drop|blocked|risk|late|behind/i.test(value);
    return {
      label,
      value: toValue(value),
      change: up ? `+${5 + index}%` : `-${2 + index}%`,
      color: up ? '#22C55E' : accentColor,
    };
  }

  const inline = line.match(/^([A-Za-z][A-Za-z0-9\s/-]{1,20})\s+([\$]?\d[\d.,]*%?|Top \d+|Patch \d+\.\d+)$/i);
  if (inline) {
    const label = toLabel(inline[1]);
    const value = inline[2].trim();
    return {
      label,
      value,
      change: `+${4 + index}%`,
      color: '#22C55E',
    };
  }

  return null;
}

function pickTitle(detailLines: string[], allLines: string[]): string {
  const candidate = [...detailLines, ...allLines].find((line) => line.length > 4 && line.length <= 34 && !line.includes(':'));
  return candidate ? toLabel(candidate) : 'Performance Signals';
}

function pickPeriod(lines: string[]): string {
  const joined = lines.join(' ').toLowerCase();
  if (joined.includes('patch')) return 'Current patch';
  if (joined.includes('week')) return 'This week';
  if (joined.includes('today')) return 'Today';
  return 'Latest cycle';
}

function toLabel(raw: string): string {
  const clean = raw.trim().replace(/[_-]+/g, ' ');
  return clean.length > 24 ? clean.slice(0, 24).trim() : clean;
}

function toValue(raw: string): string {
  const clean = raw.trim();
  return clean.length > 12 ? `${clean.slice(0, 12)}...` : clean;
}

const ChatMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const allText = lines.join('\n');
  const visibleText = allText.slice(0, charsToShow);

  return (
    <div style={{...makeCardStyle(accentColor), backgroundColor: 'white'}}>
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
    <div style={{...makeCardStyle(accentColor), backgroundColor: 'white'}}>
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
    <div style={{...makeCardStyle(accentColor), backgroundColor: 'white'}}>
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

const CommerceMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const visible = lines.join('\n').slice(0, charsToShow);
  const rows = visible.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6);
  const cards = rows.length > 0 ? rows : ['Top bundle', 'Fast checkout', 'Repeat purchase'];

  return (
    <div style={{...makeCardStyle(accentColor), backgroundColor: '#FFFCF7'}}>
      <div style={{padding: '14px 18px', borderBottom: '1px solid #F3E8D8', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{fontSize: 14, fontWeight: 600, color: '#7C2D12', fontFamily: FONT_DISPLAY}}>Storefront Ops</span>
        <span style={{fontSize: 11, color: '#B45309', fontFamily: FONT_BODY}}>Live catalog</span>
      </div>
      <div style={{padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
        {cards.slice(0, 4).map((line, i) => (
          <div key={i} style={{border: '1px solid #F3E8D8', backgroundColor: 'white', borderRadius: 10, padding: '10px 12px'}}>
            <span style={{fontSize: 12, color: '#78350F', fontFamily: FONT_BODY}}>{line}</span>
            <div style={{marginTop: 8, height: 6, borderRadius: 3, backgroundColor: '#FEF3C7'}}>
              <div style={{width: `${45 + i * 12}%`, height: 6, borderRadius: 3, backgroundColor: accentColor}} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const LedgerMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const visible = lines.join('\n').slice(0, charsToShow);
  const rows = visible.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6);
  const items = rows.length > 0 ? rows : ['Risk Score: 72', 'Settlement: 2h', 'Dispute: 1.2%'];

  return (
    <div style={{...makeCardStyle(accentColor), backgroundColor: '#FCFFFD'}}>
      <div style={{padding: '14px 18px', borderBottom: '1px solid #DCEFE5', display: 'flex', justifyContent: 'space-between'}}>
        <span style={{fontSize: 14, fontWeight: 600, color: '#14532D', fontFamily: FONT_DISPLAY}}>Ledger Console</span>
        <span style={{fontSize: 11, color: '#15803D', fontFamily: FONT_BODY}}>Auditable</span>
      </div>
      <div style={{padding: '8px 18px'}}>
        {items.map((line, i) => (
          <div key={i} style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.7fr', gap: 8, padding: '10px 0', borderBottom: '1px solid #ECF7F1'}}>
            <span style={{fontSize: 12, color: '#14532D', fontFamily: FONT_BODY}}>{line.split(':')[0] || line}</span>
            <span style={{fontSize: 12, color: '#065F46', fontFamily: FONT_BODY}}>{line.split(':')[1]?.trim() || `Line ${i + 1}`}</span>
            <span style={{fontSize: 11, color: accentColor, textAlign: 'right', fontFamily: FONT_BODY}}>{i % 2 === 0 ? 'OK' : 'Watch'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const LeaderboardMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const visible = lines.join('\n').slice(0, charsToShow);
  const rows = visible.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5);
  const entries = rows.length > 0 ? rows : ['Comp Alpha', 'Comp Nova', 'Comp Tempo'];

  return (
    <div style={{...makeCardStyle(accentColor), backgroundColor: '#FCFAFF'}}>
      <div style={{padding: '14px 18px', borderBottom: '1px solid #EADFFE', display: 'flex', justifyContent: 'space-between'}}>
        <span style={{fontSize: 14, fontWeight: 600, color: '#5B21B6', fontFamily: FONT_DISPLAY}}>Meta Leaderboard</span>
        <span style={{fontSize: 11, color: '#7C3AED', fontFamily: FONT_BODY}}>Patch live</span>
      </div>
      <div style={{padding: '10px 16px'}}>
        {entries.map((line, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #F2ECFF'}}>
            <div style={{width: 24, height: 24, borderRadius: 12, backgroundColor: i === 0 ? '#F59E0B' : '#D8B4FE', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <span style={{fontSize: 11, color: '#111', fontWeight: 700, fontFamily: FONT_BODY}}>{i + 1}</span>
            </div>
            <span style={{flex: 1, fontSize: 13, color: '#4C1D95', fontFamily: FONT_BODY}}>{line}</span>
            <span style={{fontSize: 12, color: accentColor, fontWeight: 600, fontFamily: FONT_BODY}}>{56 - i * 2}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TimelineMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const visible = lines.join('\n').slice(0, charsToShow);
  const rows = visible.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5);
  const steps = rows.length > 0 ? rows : ['Plan', 'Review', 'Execute'];

  return (
    <div style={{...makeCardStyle(accentColor), backgroundColor: '#FBFEFF'}}>
      <div style={{padding: '14px 18px', borderBottom: '1px solid #DBECF8', display: 'flex', justifyContent: 'space-between'}}>
        <span style={{fontSize: 14, fontWeight: 600, color: '#0C4A6E', fontFamily: FONT_DISPLAY}}>Cycle Timeline</span>
        <span style={{fontSize: 11, color: '#0369A1', fontFamily: FONT_BODY}}>Current cycle</span>
      </div>
      <div style={{padding: '12px 18px'}}>
        {steps.map((line, i) => (
          <div key={i} style={{display: 'flex', gap: 12, padding: '8px 0'}}>
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <div style={{width: 12, height: 12, borderRadius: 6, backgroundColor: i === 0 ? accentColor : '#93C5FD'}} />
              {i < steps.length - 1 && <div style={{width: 2, height: 20, backgroundColor: '#BFDBFE'}} />}
            </div>
            <span style={{fontSize: 13, color: '#1E3A8A', lineHeight: 1.5, fontFamily: FONT_BODY}}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const FeedMockup: React.FC<{lines: string[]; charsToShow: number; accentColor: string}> = ({
  lines, charsToShow, accentColor,
}) => {
  const visible = lines.join('\n').slice(0, charsToShow);
  const rows = visible.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 4);
  const entries = rows.length > 0 ? rows : ['New post trend', 'Comment spike', 'Moderation queue'];

  return (
    <div style={{...makeCardStyle(accentColor), backgroundColor: '#FDFDFF'}}>
      <div style={{padding: '14px 18px', borderBottom: '1px solid #E0E7FF', display: 'flex', justifyContent: 'space-between'}}>
        <span style={{fontSize: 14, fontWeight: 600, color: '#312E81', fontFamily: FONT_DISPLAY}}>Community Feed</span>
        <span style={{fontSize: 11, color: '#4F46E5', fontFamily: FONT_BODY}}>Live activity</span>
      </div>
      <div style={{padding: '10px 14px'}}>
        {entries.map((line, i) => (
          <div key={i} style={{display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 4px'}}>
            <div style={{width: 28, height: 28, borderRadius: 14, backgroundColor: i % 2 === 0 ? '#C7D2FE' : '#FBCFE8'}} />
            <div style={{flex: 1}}>
              <span style={{fontSize: 13, color: '#1F2937', fontFamily: FONT_BODY}}>{line}</span>
              <div style={{marginTop: 5, height: 5, borderRadius: 3, backgroundColor: '#EEF2FF'}}>
                <div style={{width: `${40 + i * 15}%`, height: 5, borderRadius: 3, backgroundColor: accentColor}} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const BASE_MOCKUP_MAP: Record<string, React.FC<{lines: string[]; charsToShow: number; accentColor: string}>> = {
  mail: EmailMockup,
  code: CodeMockup,
  docs: CodeMockup,
  analytics: AnalyticsMockup,
  finance: AnalyticsMockup,
  commerce: AnalyticsMockup,
  chat: ChatMockup,
  social: ChatMockup,
  support: ChatMockup,
  ai: ChatMockup,
  calendar: CalendarMockup,
  health: GenericMockup,
  media: GenericMockup,
  generic: GenericMockup,
};

function selectMockup(icon: string, domainPackId: string | undefined): React.FC<{lines: string[]; charsToShow: number; accentColor: string}> {
  const layout = getVisualTheme(domainPackId).layout;
  if (layout === 'terminal') return CodeMockup;
  if (layout === 'commerce') return CommerceMockup;
  if (layout === 'ledger') return LedgerMockup;
  if (layout === 'leaderboard') return LeaderboardMockup;
  if (layout === 'timeline') return TimelineMockup;
  if (layout === 'feed') return FeedMockup;
  return BASE_MOCKUP_MAP[icon] || GenericMockup;
}

// --- Audio Bars (MUCH bigger, matching reference) ---
const AudioBars: React.FC<{frame: number; active: boolean}> = ({frame, active}) => {
  const barConfigs = [
    {baseHeight: 0.35, width: 10},
    {baseHeight: 0.7, width: 12},
    {baseHeight: 1.0, width: 14},
    {baseHeight: 0.5, width: 12},
    {baseHeight: 0.8, width: 10},
  ];

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 5, height: 50}}>
      {barConfigs.map(({baseHeight, width}, i) => {
        const noise = smoothNoise(frame, i);
        const h = active ? Math.max(6, baseHeight * noise * 50) : 6;
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
const PillIcon: React.FC<{icon: string; accentColor: string}> = ({icon, accentColor}) => {
  const s = {width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center'} as const;
  const icons: Record<string, React.ReactNode> = {
    mail: <div style={{...s, backgroundColor: '#4285f4'}}><span style={{fontSize: 16, color: 'white'}}>✉</span></div>,
    code: <div style={{...s, backgroundColor: '#007ACC'}}><span style={{fontSize: 16, color: 'white', fontFamily: 'monospace', fontWeight: 700}}>&lt;/&gt;</span></div>,
    docs: <div style={{...s, backgroundColor: '#2563EB'}}><span style={{fontSize: 16, color: 'white'}}>▤</span></div>,
    analytics: <div style={{...s, backgroundColor: '#22C55E'}}><span style={{fontSize: 16, color: 'white'}}>◈</span></div>,
    finance: <div style={{...s, backgroundColor: '#16A34A'}}><span style={{fontSize: 16, color: 'white'}}>$</span></div>,
    commerce: <div style={{...s, backgroundColor: '#F59E0B'}}><span style={{fontSize: 16, color: 'white'}}>🛒</span></div>,
    chat: <div style={{...s, backgroundColor: '#8B5CF6'}}><span style={{fontSize: 16, color: 'white'}}>◉</span></div>,
    support: <div style={{...s, backgroundColor: '#0EA5E9'}}><span style={{fontSize: 16, color: 'white'}}>☏</span></div>,
    ai: <div style={{...s, backgroundColor: '#4F46E5'}}><span style={{fontSize: 16, color: 'white'}}>✶</span></div>,
    social: <div style={{...s, backgroundColor: '#EC4899'}}><span style={{fontSize: 16, color: 'white'}}>◎</span></div>,
    calendar: <div style={{...s, backgroundColor: '#EF4444'}}><span style={{fontSize: 16, color: 'white', fontWeight: 700, fontFamily: FONT_BODY}}>10</span></div>,
    health: <div style={{...s, backgroundColor: '#DC2626'}}><span style={{fontSize: 16, color: 'white'}}>✚</span></div>,
    media: <div style={{...s, backgroundColor: '#7C3AED'}}><span style={{fontSize: 16, color: 'white'}}>▶</span></div>,
    generic: <div style={{...s, backgroundColor: accentColor}}><span style={{fontSize: 16, color: 'white'}}>◆</span></div>,
  };
  return <>{icons[icon] || <div style={{...s, backgroundColor: accentColor}}><span style={{fontSize: 16, color: 'white'}}>●</span></div>}</>;
};

// --- Main Component ---
export const FeatureDemo: React.FC<Props> = ({feature, brandColor, accentColor, domainPackId}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const visualTheme = getVisualTheme(domainPackId);

  // Pill enters first — centered, expo ease
  const pillProgress = smoothValue(frame, 0, 18, 0, 1, easeOutExpo);
  const pillY = interpolate(pillProgress, [0, 1], [20, 0]);

  // Card enters after pill — slides up from below
  const cardProgress = smoothValue(frame, 8, 30, 0, 1, easeOutCubic);
  const cardY = interpolate(cardProgress, [0, 1], [40, 0]);
  const cardScale = interpolate(cardProgress, [0, 1], [0.94, 1]);

  // Variable-speed typing
  const typeStart = 28;
  const allText = feature.demoLines.join('\n');
  const charsToShow = getTypingChars(frame, typeStart, allText);
  const typingDone = charsToShow >= allText.length;

  // Caption appears at fixed time
  const captionShowFrame = Math.min(durationInFrames * 0.7, 130);
  const captionOpacity = smoothValue(frame, captionShowFrame, captionShowFrame + 18, 0, 1, easeOutCubic);

  // Subtle card float during typing
  const cardFloat = typingDone ? 0 : Math.sin(frame * 0.04) * 1.2;

  const Mockup = selectMockup(feature.icon, domainPackId);

  return (
    <AbsoluteFill style={{background: visualTheme.canvasGradient, justifyContent: 'center', alignItems: 'center'}}>
      {/* Blue ambient glow behind the whole assembly */}
      <div
        style={{
          position: 'absolute',
          width: 800,
          height: 600,
          background: `radial-gradient(ellipse at center, ${(visualTheme.glowColor || accentColor)}20 0%, transparent 70%)`,
          filter: 'blur(60px)',
          opacity: cardProgress,
        }}
      />

      {/* Centered column: card on top, pill below */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* Card */}
        <div
          style={{
            transform: `scale(${cardScale}) translateY(${cardY + cardFloat}px)`,
            opacity: cardProgress,
            transformOrigin: 'center bottom',
          }}
        >
          <Mockup lines={feature.demoLines} charsToShow={charsToShow} accentColor={accentColor} />
        </div>

        {/* Dynamic Island Pill — LARGE, centered below card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            backgroundColor: visualTheme.pillBackground || brandColor,
            borderRadius: 60,
            padding: '18px 36px',
            transform: `translateY(${pillY}px)`,
            opacity: pillProgress,
            boxShadow: `0 8px 40px ${(visualTheme.pillBackground || brandColor)}40, 0 0 80px ${(visualTheme.glowColor || accentColor)}18`,
          }}
        >
          <PillIcon icon={feature.icon} accentColor={accentColor} />
          <AudioBars frame={frame} active={!typingDone && frame > typeStart} />

          {/* Caption slides in */}
          {captionOpacity > 0.01 && (
            <span
              style={{
                color: 'white',
                fontSize: 20,
                fontWeight: 600,
                fontFamily: FONT_BODY,
                marginLeft: 4,
                opacity: captionOpacity,
                transform: `translateX(${(1 - captionOpacity) * 12}px)`,
                letterSpacing: '-0.01em',
              }}
            >
              {feature.caption}
            </span>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
