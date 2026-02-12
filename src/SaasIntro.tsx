import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
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

// Default weights when no sceneWeights provided (matches reference video proportions)
const DEFAULT_WEIGHTS = [4, 6, 3, 6, 5, 5, 9, 6];

// Minimum frames per scene — reference video's shortest scene is ~3s
const MIN_SCENE_FRAMES = 96;

// Crossfade duration between scenes
const CROSSFADE = 12;

// Voice delay into brand reveal (0.5s)
const VOICE_DELAY_FRAMES = 15;

const SceneMotion: React.FC<{duration: number; children: React.ReactNode}> = ({duration, children}) => {
  const frame = useCurrentFrame();
  const progress = duration <= 1 ? 1 : frame / duration;

  // NO opacity here — TransitionSeries crossfade already handles enter/exit.
  // Adding opacity here double-fades and makes everything ghostly.

  const scale = interpolate(progress, [0, 1], [1.012, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const driftY = Math.sin(progress * Math.PI) * -4;
  const driftX = Math.sin(progress * Math.PI * 2) * 1.5;

  return (
    <AbsoluteFill
      style={{
        transform: `translate3d(${driftX}px, ${driftY}px, 0) scale(${scale})`,
        transformOrigin: 'center center',
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

const FPS = 30;

export const SaasIntro: React.FC<VideoProps> = (props) => {
  const {durationInFrames} = useVideoConfig();

  // TransitionSeries reclaims overlap frames, so we budget for the full duration
  const totalCrossfade = CROSSFADE * 7;
  const availableFrames = durationInFrames + totalCrossfade;

  let scenes: number[];

  if (props.segmentDurationsMs && props.segmentDurationsMs.length === 8) {
    // EXACT SYNC: each scene = voice duration + crossfade overlap.
    // TransitionSeries "eats" CROSSFADE frames at each boundary.
    // By adding CROSSFADE to each scene's voice frames, the transition midpoint
    // aligns exactly with when that segment's voice starts.
    const voiceFrames = props.segmentDurationsMs.map(ms => Math.ceil((ms / 1000) * FPS));
    scenes = voiceFrames.map((vf, i) => {
      if (i === 0) {
        // Scene 0: voice delay + voice duration + crossfade overlap
        return Math.max(VOICE_DELAY_FRAMES + vf + CROSSFADE, MIN_SCENE_FRAMES);
      }
      if (i === 7) {
        // Last scene: voice duration + 1s CTA hold (no trailing crossfade)
        return Math.max(vf + 30, MIN_SCENE_FRAMES);
      }
      // Middle scenes: voice duration + crossfade overlap
      return Math.max(vf + CROSSFADE, MIN_SCENE_FRAMES);
    });
  } else {
    // Fallback: proportional weights
    const weights = props.sceneWeights && props.sceneWeights.length === 8
      ? props.sceneWeights
      : DEFAULT_WEIGHTS;
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map(w => Math.round((w / totalWeight) * availableFrames));
    scenes = raw.map(d => Math.max(d, MIN_SCENE_FRAMES));
  }

  // Voice starts after brief visual intro
  const voiceStartFrame = props.segmentDurationsMs ? VOICE_DELAY_FRAMES : Math.round(scenes[0] * 0.10);

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
            <SceneMotion duration={scenes[0]}>
              <BrandReveal
                brandName={props.brandName}
                brandColor={props.brandColor}
                accentColor={props.accentColor}
              />
            </SceneMotion>
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[1]}>
            <SceneMotion duration={scenes[1]}>
              <HookText
                line1={props.hookLine1}
                line2={props.hookLine2}
                keyword={props.hookKeyword}
                accentColor={props.accentColor}
                brandColor={props.brandColor}
              />
            </SceneMotion>
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[2]}>
            <SceneMotion duration={scenes[2]}>
              <Wordmark
                brandName={props.brandName}
                brandColor={props.brandColor}
                tagline={props.tagline}
              />
            </SceneMotion>
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[3]}>
            <SceneMotion duration={scenes[3]}>
              <FeatureDemo
                feature={props.features[0]}
                brandColor={props.brandColor}
                accentColor={props.accentColor}
                domainPackId={props.domainPackId}
              />
            </SceneMotion>
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[4]}>
            <SceneMotion duration={scenes[4]}>
              <FeatureDemo
                feature={props.features[1]}
                brandColor={props.brandColor}
                accentColor={props.accentColor}
                domainPackId={props.domainPackId}
              />
            </SceneMotion>
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[5]}>
            <SceneMotion duration={scenes[5]}>
              <FeatureDemo
                feature={props.features[2]}
                brandColor={props.brandColor}
                accentColor={props.accentColor}
                domainPackId={props.domainPackId}
              />
            </SceneMotion>
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[6]}>
            <SceneMotion duration={scenes[6]}>
              <Integrations
                integrations={props.integrations}
                brandColor={props.brandColor}
                accentColor={props.accentColor}
                brandName={props.brandName}
              />
            </SceneMotion>
          </TransitionSeries.Sequence>

          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({durationInFrames: CROSSFADE})}
          />

          <TransitionSeries.Sequence durationInFrames={scenes[7]}>
            <SceneMotion duration={scenes[7]}>
              <Closing
                brandName={props.brandName}
                brandColor={props.brandColor}
                accentColor={props.accentColor}
                ctaUrl={props.ctaUrl}
              />
            </SceneMotion>
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
