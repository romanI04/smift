import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {BrandReveal} from './scenes/BrandReveal';
import {HookText} from './scenes/HookText';
import {Wordmark} from './scenes/Wordmark';
import {FeatureDemo} from './scenes/FeatureDemo';
import {Integrations} from './scenes/Integrations';
import {Closing} from './scenes/Closing';
import {FadeIn} from './scenes/Transition';
import {CinematicOverlay} from './scenes/CinematicOverlay';
import type {VideoProps} from './types';

// Timeline proportions (relative to total duration)
// These define WHERE each scene starts/ends as a fraction of total video length
const TIMELINE = {
  brandReveal:   {start: 0,     end: 0.069},   // ~3s
  hookText:      {start: 0.062, end: 0.156},   // ~4.2s
  wordmark:      {start: 0.149, end: 0.210},   // ~2.8s
  feature1:      {start: 0.207, end: 0.352},   // ~6.7s
  feature2:      {start: 0.348, end: 0.493},   // ~6.7s
  feature3:      {start: 0.489, end: 0.620},   // ~5.8s
  integrations:  {start: 0.612, end: 0.786},   // ~7.8s
  closing:       {start: 0.776, end: 1.0},     // ~10.3s
};

// Voice starts after BrandReveal
const VOICE_START_FRAC = 0.062;

export const SaasIntro: React.FC<VideoProps> = (props) => {
  const {durationInFrames} = useVideoConfig();

  // Helper: convert fraction to frame number
  const f = (frac: number) => Math.round(frac * durationInFrames);
  // Helper: duration between two fractions
  const dur = (start: number, end: number) => f(end) - f(start);

  return (
    <CinematicOverlay>
      <AbsoluteFill style={{backgroundColor: 'white'}}>
        {/* Voice narration */}
        {props.audioSrc && (
          <Sequence from={f(VOICE_START_FRAC)} name="Narration">
            <Audio src={staticFile(props.audioSrc)} volume={1} />
          </Sequence>
        )}

        <Sequence from={f(TIMELINE.brandReveal.start)} durationInFrames={dur(TIMELINE.brandReveal.start, TIMELINE.brandReveal.end)} name="Brand Reveal">
          <BrandReveal
            brandName={props.brandName}
            brandColor={props.brandColor}
            accentColor={props.accentColor}
          />
        </Sequence>

        <Sequence from={f(TIMELINE.hookText.start)} durationInFrames={dur(TIMELINE.hookText.start, TIMELINE.hookText.end)} name="Hook Text">
          <FadeIn durationFrames={10}>
            <HookText
              line1={props.hookLine1}
              line2={props.hookLine2}
              keyword={props.hookKeyword}
              accentColor={props.accentColor}
              brandColor={props.brandColor}
            />
          </FadeIn>
        </Sequence>

        <Sequence from={f(TIMELINE.wordmark.start)} durationInFrames={dur(TIMELINE.wordmark.start, TIMELINE.wordmark.end)} name="Wordmark">
          <FadeIn durationFrames={8}>
            <Wordmark
              brandName={props.brandName}
              brandColor={props.brandColor}
              tagline={props.tagline}
            />
          </FadeIn>
        </Sequence>

        <Sequence from={f(TIMELINE.feature1.start)} durationInFrames={dur(TIMELINE.feature1.start, TIMELINE.feature1.end)} name={`Feature 1: ${props.features[0]?.appName || ''}`}>
          <FadeIn durationFrames={8}>
            <FeatureDemo
              feature={props.features[0]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </FadeIn>
        </Sequence>

        <Sequence from={f(TIMELINE.feature2.start)} durationInFrames={dur(TIMELINE.feature2.start, TIMELINE.feature2.end)} name={`Feature 2: ${props.features[1]?.appName || ''}`}>
          <FadeIn durationFrames={8}>
            <FeatureDemo
              feature={props.features[1]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </FadeIn>
        </Sequence>

        <Sequence from={f(TIMELINE.feature3.start)} durationInFrames={dur(TIMELINE.feature3.start, TIMELINE.feature3.end)} name={`Feature 3: ${props.features[2]?.appName || ''}`}>
          <FadeIn durationFrames={8}>
            <FeatureDemo
              feature={props.features[2]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </FadeIn>
        </Sequence>

        <Sequence from={f(TIMELINE.integrations.start)} durationInFrames={dur(TIMELINE.integrations.start, TIMELINE.integrations.end)} name="Integrations">
          <FadeIn durationFrames={10}>
            <Integrations
              integrations={props.integrations}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
              brandName={props.brandName}
            />
          </FadeIn>
        </Sequence>

        <Sequence from={f(TIMELINE.closing.start)} durationInFrames={dur(TIMELINE.closing.start, TIMELINE.closing.end)} name="Closing">
          <Closing
            brandName={props.brandName}
            brandColor={props.brandColor}
            accentColor={props.accentColor}
            ctaUrl={props.ctaUrl}
          />
        </Sequence>
      </AbsoluteFill>
    </CinematicOverlay>
  );
};
