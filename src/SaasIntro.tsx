import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
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

// Default weights (used when no voice / no sceneWeights)
const DEFAULT_WEIGHTS = [4, 6, 3, 8, 8, 7, 7, 6];

// Minimum frames per scene to avoid degenerate durations
const MIN_SCENE_FRAMES = 30;

// Transition overlap in frames
const OVERLAP_FRAMES = 8;

export const SaasIntro: React.FC<VideoProps> = (props) => {
  const {durationInFrames, fps} = useVideoConfig();

  const weights = props.sceneWeights && props.sceneWeights.length === 8
    ? props.sceneWeights
    : DEFAULT_WEIGHTS;

  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Total frames consumed by transitions (7 transitions between 8 scenes)
  const totalOverlap = OVERLAP_FRAMES * 7;
  // Available frames for scene content
  const availableFrames = durationInFrames + totalOverlap; // TransitionSeries adds overlap back

  // Compute per-scene durations proportional to word counts
  const rawDurations = weights.map(w => Math.round((w / totalWeight) * availableFrames));

  // Enforce minimums
  const scenes = rawDurations.map(d => Math.max(d, MIN_SCENE_FRAMES));

  // Voice starts at the beginning of the composition (brand reveal has narration segment 1)
  const voiceStartFrame = Math.round(scenes[0] * 0.15); // slight delay into brand reveal

  return (
    <CinematicOverlay>
      <AbsoluteFill style={{backgroundColor: '#FAFAFA'}}>
        {/* Voice narration */}
        {props.audioSrc && (
          <Sequence from={voiceStartFrame} name="Narration">
            <Audio src={staticFile(props.audioSrc)} volume={1} />
          </Sequence>
        )}

        {/* Scene sequence with transitions */}
        <TransitionSeries>
          {/* 1. Brand Reveal */}
          <TransitionSeries.Sequence durationInFrames={scenes[0]}>
            <BrandReveal
              brandName={props.brandName}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: OVERLAP_FRAMES})}
          />

          {/* 2. Hook Text */}
          <TransitionSeries.Sequence durationInFrames={scenes[1]}>
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
            timing={springTiming({config: {damping: 14, stiffness: 80}, durationInFrames: OVERLAP_FRAMES + 4})}
          />

          {/* 3. Wordmark */}
          <TransitionSeries.Sequence durationInFrames={scenes[2]}>
            <Wordmark
              brandName={props.brandName}
              brandColor={props.brandColor}
              tagline={props.tagline}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={wipe({direction: 'from-left'})}
            timing={linearTiming({durationInFrames: OVERLAP_FRAMES + 2})}
          />

          {/* 4. Feature 1 */}
          <TransitionSeries.Sequence durationInFrames={scenes[3]}>
            <FeatureDemo
              feature={props.features[0]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={slide({direction: 'from-right'})}
            timing={springTiming({config: {damping: 16, stiffness: 90}, durationInFrames: OVERLAP_FRAMES + 2})}
          />

          {/* 5. Feature 2 */}
          <TransitionSeries.Sequence durationInFrames={scenes[4]}>
            <FeatureDemo
              feature={props.features[1]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={slide({direction: 'from-left'})}
            timing={springTiming({config: {damping: 16, stiffness: 90}, durationInFrames: OVERLAP_FRAMES + 2})}
          />

          {/* 6. Feature 3 */}
          <TransitionSeries.Sequence durationInFrames={scenes[5]}>
            <FeatureDemo
              feature={props.features[2]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={wipe({direction: 'from-right'})}
            timing={linearTiming({durationInFrames: OVERLAP_FRAMES + 4})}
          />

          {/* 7. Integrations */}
          <TransitionSeries.Sequence durationInFrames={scenes[6]}>
            <Integrations
              integrations={props.integrations}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
              brandName={props.brandName}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: OVERLAP_FRAMES + 6})}
          />

          {/* 8. Closing */}
          <TransitionSeries.Sequence durationInFrames={scenes[7]}>
            <Closing
              brandName={props.brandName}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
              ctaUrl={props.ctaUrl}
            />
          </TransitionSeries.Sequence>
        </TransitionSeries>

        {/* Persistent dot motif */}
        <DotMotif
          brandColor={props.brandColor}
          accentColor={props.accentColor}
        />
      </AbsoluteFill>
    </CinematicOverlay>
  );
};
