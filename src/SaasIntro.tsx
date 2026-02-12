import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {TransitionSeries, linearTiming, springTiming} from '@remotion/transitions';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {fade} from '@remotion/transitions/fade';
import {BrandReveal} from './scenes/BrandReveal';
import {HookText} from './scenes/HookText';
import {Wordmark} from './scenes/Wordmark';
import {FeatureDemo} from './scenes/FeatureDemo';
import {Integrations} from './scenes/Integrations';
import {Closing} from './scenes/Closing';
import {CinematicOverlay} from './scenes/CinematicOverlay';
import {DotMotif} from './scenes/DotMotif';
import type {VideoProps} from './types';

// Scene durations as fractions of total video length
const SCENE_FRACS = {
  brandReveal:  0.10,
  hookText:     0.14,
  wordmark:     0.08,
  feature1:     0.15,
  feature2:     0.15,
  feature3:     0.13,
  integrations: 0.15,
  closing:      0.18,
};

// Overlap duration for transitions (fraction of total)
const OVERLAP_FRAC = 0.025;

// Voice starts shortly after brand reveal
const VOICE_START_FRAC = 0.06;

export const SaasIntro: React.FC<VideoProps> = (props) => {
  const {durationInFrames, fps} = useVideoConfig();

  // Convert fraction to frames
  const f = (frac: number) => Math.round(frac * durationInFrames);
  const overlap = f(OVERLAP_FRAC);

  // Scene durations in frames
  const scenes = {
    brandReveal:  f(SCENE_FRACS.brandReveal),
    hookText:     f(SCENE_FRACS.hookText),
    wordmark:     f(SCENE_FRACS.wordmark),
    feature1:     f(SCENE_FRACS.feature1),
    feature2:     f(SCENE_FRACS.feature2),
    feature3:     f(SCENE_FRACS.feature3),
    integrations: f(SCENE_FRACS.integrations),
    closing:      f(SCENE_FRACS.closing),
  };

  return (
    <CinematicOverlay>
      <AbsoluteFill style={{backgroundColor: '#FAFAFA'}}>
        {/* Voice narration */}
        {props.audioSrc && (
          <Sequence from={f(VOICE_START_FRAC)} name="Narration">
            <Audio src={staticFile(props.audioSrc)} volume={1} />
          </Sequence>
        )}

        {/* Scene sequence with transitions */}
        <TransitionSeries>
          {/* 1. Brand Reveal — orb morphs to dot */}
          <TransitionSeries.Sequence durationInFrames={scenes.brandReveal}>
            <BrandReveal
              brandName={props.brandName}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: overlap})}
          />

          {/* 2. Hook Text — kinetic typography */}
          <TransitionSeries.Sequence durationInFrames={scenes.hookText}>
            <HookText
              line1={props.hookLine1}
              line2={props.hookLine2}
              keyword={props.hookKeyword}
              accentColor={props.accentColor}
              brandColor={props.brandColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={slide({direction: 'from-bottom'})}
            timing={springTiming({config: {damping: 14, stiffness: 80}, durationInFrames: overlap + 4})}
          />

          {/* 3. Wordmark flash */}
          <TransitionSeries.Sequence durationInFrames={scenes.wordmark}>
            <Wordmark
              brandName={props.brandName}
              brandColor={props.brandColor}
              tagline={props.tagline}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={wipe({direction: 'from-left'})}
            timing={linearTiming({durationInFrames: overlap + 2})}
          />

          {/* 4. Feature 1 */}
          <TransitionSeries.Sequence durationInFrames={scenes.feature1}>
            <FeatureDemo
              feature={props.features[0]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={slide({direction: 'from-right'})}
            timing={springTiming({config: {damping: 16, stiffness: 90}, durationInFrames: overlap + 2})}
          />

          {/* 5. Feature 2 */}
          <TransitionSeries.Sequence durationInFrames={scenes.feature2}>
            <FeatureDemo
              feature={props.features[1]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={slide({direction: 'from-left'})}
            timing={springTiming({config: {damping: 16, stiffness: 90}, durationInFrames: overlap + 2})}
          />

          {/* 6. Feature 3 */}
          <TransitionSeries.Sequence durationInFrames={scenes.feature3}>
            <FeatureDemo
              feature={props.features[2]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={wipe({direction: 'from-right'})}
            timing={linearTiming({durationInFrames: overlap + 4})}
          />

          {/* 7. Integrations carousel */}
          <TransitionSeries.Sequence durationInFrames={scenes.integrations}>
            <Integrations
              integrations={props.integrations}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
              brandName={props.brandName}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: overlap + 6})}
          />

          {/* 8. Closing */}
          <TransitionSeries.Sequence durationInFrames={scenes.closing}>
            <Closing
              brandName={props.brandName}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
              ctaUrl={props.ctaUrl}
            />
          </TransitionSeries.Sequence>
        </TransitionSeries>

        {/* Persistent dot motif — travels across scenes */}
        <DotMotif
          brandColor={props.brandColor}
          accentColor={props.accentColor}
        />
      </AbsoluteFill>
    </CinematicOverlay>
  );
};
