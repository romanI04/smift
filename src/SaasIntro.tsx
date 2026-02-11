import {AbsoluteFill, Sequence} from 'remotion';
import {BrandReveal} from './scenes/BrandReveal';
import {HookText} from './scenes/HookText';
import {Wordmark} from './scenes/Wordmark';
import {FeatureDemo} from './scenes/FeatureDemo';
import {Integrations} from './scenes/Integrations';
import {Closing} from './scenes/Closing';
import {FadeIn} from './scenes/Transition';
import type {VideoProps} from './types';

// Timeline (30fps, 46s = 1380 frames)
//
// 0-90      BrandReveal     (3s)   orb → black dot
// 85-210    HookText        (4.2s) kinetic text, overlaps for crossfade
// 205-290   Wordmark        (2.8s) brand name + tagline flash
// 285-485   Feature 1       (6.7s) email demo
// 480-680   Feature 2       (6.7s) claude demo
// 675-850   Feature 3       (5.8s) twitter demo
// 845-1080  Integrations    (7.8s) icon carousel
// 1070-1380 Closing         (10.3s) ring → wordmark → url

export const SaasIntro: React.FC<VideoProps> = (props) => {
  return (
    <AbsoluteFill style={{backgroundColor: 'white'}}>
      <Sequence from={0} durationInFrames={95} name="Brand Reveal">
        <BrandReveal
          brandName={props.brandName}
          brandColor={props.brandColor}
          accentColor={props.accentColor}
        />
      </Sequence>

      <Sequence from={85} durationInFrames={130} name="Hook Text">
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

      <Sequence from={205} durationInFrames={85} name="Wordmark">
        <FadeIn durationFrames={8}>
          <Wordmark
            brandName={props.brandName}
            brandColor={props.brandColor}
            tagline={props.tagline}
          />
        </FadeIn>
      </Sequence>

      <Sequence from={285} durationInFrames={200} name="Feature: Email">
        <FadeIn durationFrames={8}>
          <FeatureDemo
            feature={props.features[0]}
            brandColor={props.brandColor}
            accentColor={props.accentColor}
          />
        </FadeIn>
      </Sequence>

      <Sequence from={480} durationInFrames={200} name="Feature: Claude">
        <FadeIn durationFrames={8}>
          <FeatureDemo
            feature={props.features[1]}
            brandColor={props.brandColor}
            accentColor={props.accentColor}
          />
        </FadeIn>
      </Sequence>

      <Sequence from={675} durationInFrames={180} name="Feature: X">
        <FadeIn durationFrames={8}>
          <FeatureDemo
            feature={props.features[2]}
            brandColor={props.brandColor}
            accentColor={props.accentColor}
          />
        </FadeIn>
      </Sequence>

      <Sequence from={845} durationInFrames={240} name="Integrations">
        <FadeIn durationFrames={10}>
          <Integrations
            integrations={props.integrations}
            brandColor={props.brandColor}
            accentColor={props.accentColor}
            brandName={props.brandName}
          />
        </FadeIn>
      </Sequence>

      <Sequence from={1070} durationInFrames={310} name="Closing">
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
