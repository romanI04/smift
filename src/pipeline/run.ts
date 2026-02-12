import {scrapeUrl} from './scraper';
import {generateScript} from './scriptgen';
import {generateVoice, generateVoicePerSegment} from './voice';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load env from clawd root
dotenv.config({path: path.resolve(__dirname, '../../../../.env')});

type VoiceEngine = 'elevenlabs' | 'openai' | 'chatterbox' | 'none';
type QualityPreset = 'draft' | 'yc';

async function run() {
  const args = process.argv.slice(2);
  const voiceFlag = args.find(a => a.startsWith('--voice='));
  const voiceEngine = voiceFlag ? voiceFlag.split('=')[1] as VoiceEngine : undefined;
  const qualityFlag = args.find(a => a.startsWith('--quality='));
  const quality = (qualityFlag ? qualityFlag.split('=')[1] : 'yc') as QualityPreset;
  const url = args.find(a => !a.startsWith('--'));
  if (!url) {
    console.error('Usage: npm run generate -- <url> [--voice=none|elevenlabs|openai|chatterbox] [--quality=draft|yc]');
    process.exit(1);
  }

  const outputName = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
  const outputDir = path.resolve(__dirname, '../../out');
  const publicDir = path.resolve(__dirname, '../../public');

  // Ensure dirs exist
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, {recursive: true});

  console.log(`\n[1/4] Scraping ${url}...`);
  const scraped = await scrapeUrl(url);
  console.log(`  -> ${scraped.title}`);
  console.log(`  -> ${scraped.headings.length} headings, ${scraped.features.length} features found`);

  console.log(`\n[2/4] Generating script via OpenAI...`);
  const script = await generateScript(scraped);
  console.log(`  -> Brand: ${script.brandName}`);
  console.log(`  -> Hook: "${script.hookLine1} ${script.hookLine2} ${script.hookKeyword}"`);
  console.log(`  -> Features: ${script.features.map(f => f.appName).join(', ')}`);
  console.log(`  -> Narration segments:`);
  const sceneNames = ['Brand Reveal', 'Hook Text', 'Wordmark', 'Feature 1', 'Feature 2', 'Feature 3', 'Integrations', 'Closing'];
  script.narrationSegments.forEach((seg, i) => {
    console.log(`     ${sceneNames[i]}: "${seg}"`);
  });
  console.log(`  -> Scene weights: [${script.sceneWeights?.join(', ')}]`);

  // Join segments into full narration for TTS
  const fullNarration = script.narrationSegments.join(' ');
  console.log(`  -> Full narration (${fullNarration.split(/\s+/).length} words): "${fullNarration}"`);

  // Save script for debugging
  const scriptPath = path.join(outputDir, `${outputName}-script.json`);
  fs.writeFileSync(scriptPath, JSON.stringify({...script, narration: fullNarration}, null, 2));
  console.log(`  -> Script saved to ${scriptPath}`);

  console.log(`\n[3/4] Generating voice (per-segment for exact sync)...`);
  const audioFilename = `${outputName}-voice.mp3`;
  const audioPath = path.join(outputDir, audioFilename);
  let voiceResult: {path: string; durationMs: number} | null = null;
  let estimatedDurationMs: number | null = null;
  let segmentDurationsMs: number[] | null = null;

  if (voiceEngine === 'none') {
    estimatedDurationMs = estimateNarrationDurationMs(fullNarration);
    console.log(`  -> Voice disabled by flag. Using estimated duration: ${estimatedDurationMs}ms`);
  } else {
    try {
      const segResult = await generateVoicePerSegment(
        script.narrationSegments,
        audioPath,
        voiceEngine,
      );
      voiceResult = {path: segResult.path, durationMs: segResult.totalDurationMs};
      segmentDurationsMs = segResult.segmentDurationsMs;
      console.log(`  -> Audio: ${voiceResult.path} (${voiceResult.durationMs}ms) via ${segResult.engineUsed}`);
      console.log(`  -> Per-segment durations (ms): [${segmentDurationsMs.join(', ')}]`);

      // Copy voice to public/ so Remotion's staticFile() can find it
      const publicAudioPath = path.join(publicDir, 'voice.mp3');
      fs.copyFileSync(audioPath, publicAudioPath);
      console.log(`  -> Copied to public/voice.mp3 for Remotion`);
    } catch (e: any) {
      console.warn(`  -> Voice generation failed: ${e.message}`);
      estimatedDurationMs = estimateNarrationDurationMs(fullNarration);
      console.warn(`  -> Continuing without voice...`);
      console.warn(`  -> Using estimated narration duration for pacing: ${estimatedDurationMs}ms`);
    }
  }

  console.log(`\n[4/4] Rendering video with Remotion...`);
  const entryPoint = path.resolve(__dirname, '../index.ts');
  const bundled = await bundle({entryPoint, publicDir});

  const inputProps: Record<string, unknown> = {
    ...script,
    // Audio props — only if voice was generated
    ...(voiceResult && {
      audioSrc: 'voice.mp3',
      audioDurationMs: voiceResult.durationMs,
    }),
    // Timing fallback when TTS is unavailable
    ...(!voiceResult && estimatedDurationMs && {
      audioDurationMs: estimatedDurationMs,
    }),
    // Per-segment durations for exact voice-to-scene sync
    ...(segmentDurationsMs && {segmentDurationsMs}),
  };

  // Remove pipeline-only fields from props
  delete inputProps.narrationSegments;

  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'SaasIntro',
    inputProps,
  });

  const videoPath = path.join(outputDir, `${outputName}.mp4`);
  const qualityOptions = quality === 'draft'
    ? {
      crf: 23,
      x264Preset: 'veryfast' as const,
      imageFormat: 'jpeg' as const,
      audioCodec: 'aac' as const,
      audioBitrate: '192k' as const,
    }
    : {
      crf: 16,
      x264Preset: 'slow' as const,
      imageFormat: 'png' as const,
      pixelFormat: 'yuv420p' as const,
      audioCodec: 'aac' as const,
      audioBitrate: '320k' as const,
      encodingMaxRate: '16M' as const,
      encodingBufferSize: '32M' as const,
    };

  await renderMedia({
    composition: {...composition, props: inputProps},
    serveUrl: bundled,
    codec: 'h264',
    ...qualityOptions,
    outputLocation: videoPath,
    concurrency: 4,
    enforceAudioTrack: true,
  });

  console.log(`\n✓ Done!`);
  console.log(`  Video: ${videoPath}`);
  console.log(`  Quality preset: ${quality}`);
  if (voiceResult) {
    console.log(`  Voice is baked into the video!`);
  }
}

function estimateNarrationDurationMs(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 30000;

  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const sentences = (trimmed.match(/[.!?]+/g) || []).length;

  // ~160 wpm base plus small per-sentence pause.
  const baseMs = words * 375;
  const pauseMs = sentences * 250;
  return Math.max(30000, baseMs + pauseMs);
}

async function generateVoiceWithFallback(
  text: string,
  outputPath: string,
  requestedEngine?: Exclude<VoiceEngine, 'none'>,
): Promise<{result: {path: string; durationMs: number}; engineUsed: Exclude<VoiceEngine, 'none'>}> {
  const tryEngine = async (engine: Exclude<VoiceEngine, 'none'>) => {
    const result = await generateVoice(text, {outputPath, engine});
    return {result, engineUsed: engine};
  };

  if (requestedEngine) {
    return tryEngine(requestedEngine);
  }

  const fallbackEngines: Exclude<VoiceEngine, 'none'>[] = ['chatterbox'];
  if (process.env.openai_api_key) fallbackEngines.push('openai');
  if (process.env.eleven_labs_api_key) fallbackEngines.push('elevenlabs');

  const errors: string[] = [];
  for (const engine of fallbackEngines) {
    try {
      console.log(`  -> Trying ${engine}...`);
      return await tryEngine(engine);
    } catch (e: any) {
      errors.push(`${engine}: ${e.message}`);
      console.warn(`  -> ${engine} failed, trying next fallback...`);
    }
  }

  throw new Error(errors.length ? errors.join(' | ') : 'No TTS engines configured');
}

run().catch((e) => {
  console.error('Pipeline failed:', e.message);
  process.exit(1);
});
