import {Composition} from 'remotion';
import {SaasIntro} from './SaasIntro';
import {voiceosData} from './data/voiceos';
import type {VideoProps} from './types';

const FPS = 30;
const FALLBACK_DURATION = 1380; // 46s at 30fps (no audio fallback)

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SaasIntro"
        component={SaasIntro}
        durationInFrames={FALLBACK_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={voiceosData}
        calculateMetadata={async ({props}: {props: VideoProps}) => {
          if (props.audioDurationMs) {
            // Voice starts ~0.5s in, then plays, then 2.5s closing hold
            const voiceFrames = Math.ceil((props.audioDurationMs / 1000) * FPS);
            const totalFrames = 15 + voiceFrames + 75;
            return {durationInFrames: totalFrames};
          }
          return {durationInFrames: FALLBACK_DURATION};
        }}
      />
    </>
  );
};
