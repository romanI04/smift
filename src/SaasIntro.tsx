import {AbsoluteFill, Sequence} from 'remotion';
import {BrandReveal} from './scenes/BrandReveal';
import {HookText} from './scenes/HookText';
import {FeatureDemo} from './scenes/FeatureDemo';
import {Integrations} from './scenes/Integrations';
import {Closing} from './scenes/Closing';
import type {VideoProps} from './types';

// Timing (30fps)
// Scene 1: BrandReveal    0-90   (0-3s)
// Scene 2: HookText       90-210 (3-7s)
// Scene 3: Feature 1      210-420 (7-14s)
// Scene 4: Feature 2      420-630 (14-21s)
// Scene 5: Feature 3      630-810 (21-27s)
// Scene 6: Integrations   810-1050 (27-35s)
// Scene 7: Closing         1050-1380 (35-46s)

export const SaasIntro: React.FC<VideoProps> = (props) => {
  return (
    <AbsoluteFill style={{backgroundColor: 'white'}}>
      <Sequence from={0} durationInFrames={90} name="Brand Reveal">
        <BrandReveal
          brandName={props.brandName}
          brandColor={props.brandColor}
          accentColor={props.accentColor}
        />
      </Sequence>

      <Sequence from={90} durationInFrames={120} name="Hook Text">
        <HookText
          line1={props.hookLine1}
          line2={props.hookLine2}
          keyword={props.hookKeyword}
          accentColor={props.accentColor}
          brandColor={props.brandColor}
        />
      </Sequence>

      {props.features.map((feature, i) => (
        <Sequence
          key={i}
          from={210 + i * 200}
          durationInFrames={200}
          name={`Feature: ${feature.appName}`}
        >
          <FeatureDemo
            feature={feature}
            brandColor={props.brandColor}
            accentColor={props.accentColor}
          />
        </Sequence>
      ))}

      <Sequence from={810} durationInFrames={240} name="Integrations">
        <Integrations
          integrations={props.integrations}
          brandColor={props.brandColor}
          accentColor={props.accentColor}
          brandName={props.brandName}
        />
      </Sequence>

      <Sequence from={1050} durationInFrames={330} name="Closing">
        <Closing
          brandName={props.brandName}
          brandColor={props.brandColor}
          accentColor={props.accentColor}
          ctaUrl={props.ctaUrl}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
