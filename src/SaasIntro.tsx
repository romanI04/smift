import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
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

// Default weights when no sceneWeights provided
const DEFAULT_WEIGHTS = [4, 6, 3, 8, 8, 7, 7, 6];

// Minimum frames per scene — short scenes look rushed
const MIN_SCENE_FRAMES = 60;

// Crossfade duration between scenes
const CROSSFADE = 10;

export const SaasIntro: React.FC<VideoProps> = (props) => {
  const {durationInFrames} = useVideoConfig();

  const weights = props.sceneWeights && props.sceneWeights.length === 8
    ? props.sceneWeights
    : DEFAULT_WEIGHTS;

  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // TransitionSeries reclaims overlap frames, so we budget for the full duration
  const totalCrossfade = CROSSFADE * 7;
  const availableFrames = durationInFrames + totalCrossfade;

  // Proportional durations from word counts
  const raw = weights.map(w => Math.round((w / totalWeight) * availableFrames));

  // Enforce minimums — redistribute from longest scenes if needed
  const scenes = raw.map(d => Math.max(d, MIN_SCENE_FRAMES));

  // Voice starts slightly into brand reveal
  const voiceStartFrame = Math.round(scenes[0] * 0.12);

  return (
    <CinematicOverlay>
      <AbsoluteFill style={{backgroundColor: '#FAFAFA'}}>
        {/* Voice narration */}
        {props.audioSrc && (
          <Sequence from={voiceStartFrame} name="Narration">
            <Audio src={staticFile(props.audioSrc)} volume={1} />
          </Sequence>
        )}

        {/* All scenes crossfade — smooth, no directional motion */}
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={scenes[0]}>
            <BrandReveal
              brandName={props.brandName}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

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
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[2]}>
            <Wordmark
              brandName={props.brandName}
              brandColor={props.brandColor}
              tagline={props.tagline}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[3]}>
            <FeatureDemo
              feature={props.features[0]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[4]}>
            <FeatureDemo
              feature={props.features[1]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[5]}>
            <FeatureDemo
              feature={props.features[2]}
              brandColor={props.brandColor}
              accentColor={props.accentColor}
            />
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

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
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

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
