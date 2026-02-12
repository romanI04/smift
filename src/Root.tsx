import {Composition} from 'remotion';
import {SaasIntro} from './SaasIntro';
import {voiceosData} from './data/voiceos';
import type {VideoProps} from './types';

const FPS = 30;
const FALLBACK_DURATION = 1380; // 46s at 30fps (no audio fallback)

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition<any, VideoProps>
        id="SaasIntro"
        component={SaasIntro}
        durationInFrames={FALLBACK_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={voiceosData}
        calculateMetadata={async ({props}) => {
          const typedProps = props as VideoProps;
          if (typedProps.segmentDurationsMs && typedProps.segmentDurationsMs.length === 8) {
            // Mirror SaasIntro scene math: voiceFrames + crossfade overlap per scene
            const CROSSFADE = 12;
            const VOICE_DELAY = 15;
            const MIN = 96;
            const vf = typedProps.segmentDurationsMs.map(ms => Math.ceil((ms / 1000) * FPS));
            const scenes = vf.map((f, i) => {
              if (i === 0) return Math.max(VOICE_DELAY + f + CROSSFADE, MIN);
              if (i === 7) return Math.max(f + 30, MIN);
              return Math.max(f + CROSSFADE, MIN);
            });
            const totalSceneFrames = scenes.reduce((a, b) => a + b, 0);
            // TransitionSeries reclaims 7 crossfade overlaps
            return {durationInFrames: totalSceneFrames - 7 * CROSSFADE};
          }
          if (typedProps.audioDurationMs) {
            // Voice starts ~0.5s in, then plays, then 2.5s closing hold
            const voiceFrames = Math.ceil((typedProps.audioDurationMs / 1000) * FPS);
            const totalFrames = 15 + voiceFrames + 75;
            return {durationInFrames: totalFrames};
          }
          return {durationInFrames: FALLBACK_DURATION};
        }}
      />
    </>
  );
};
