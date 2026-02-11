import {Composition} from 'remotion';
import {SaasIntro} from './SaasIntro';
import {voiceosData} from './data/voiceos';
import type {VideoProps} from './types';

const FPS = 30;
const BASE_DURATION = 1380; // 46s at 30fps (no audio)

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SaasIntro"
        component={SaasIntro}
        durationInFrames={BASE_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={voiceosData}
        calculateMetadata={async ({props}: {props: VideoProps}) => {
          if (props.audioDurationMs) {
            // Voice starts at ~frame 85 (after BrandReveal)
            // Add 6s buffer for closing after voice ends
            const voiceFrames = Math.ceil((props.audioDurationMs / 1000) * FPS);
            const totalFrames = Math.max(BASE_DURATION, 85 + voiceFrames + 180);
            return {durationInFrames: totalFrames};
          }
          return {durationInFrames: BASE_DURATION};
        }}
      />
    </>
  );
};
