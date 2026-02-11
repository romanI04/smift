import {Composition} from 'remotion';
import {SaasIntro} from './SaasIntro';
import {voiceosData} from './data/voiceos';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SaasIntro"
        component={SaasIntro}
        durationInFrames={1380}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={voiceosData}
      />
    </>
  );
};
