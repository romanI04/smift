import {scrapeUrl} from './scraper';
import {generateScript} from './scriptgen';
import {generateVoicePerSegment, generateVoiceSingleCall} from './voice';
import {selectTemplate, type TemplateId} from './templates';
import {scoreScriptQuality, toQualityFeedback, type QualityReport} from './quality';
import {buildFallbackScript} from './fallback-script';
import {autoFixScriptQuality} from './autofix';
import type {ScriptResult} from './script-types';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load env from clawd root
dotenv.config({path: path.resolve(__dirname, '../../../../.env')});

type VoiceEngine = 'elevenlabs' | 'openai' | 'chatterbox' | 'none';
type QualityPreset = 'draft' | 'yc';
type TemplateArg = 'auto' | TemplateId;
type VoiceMode = 'single' | 'segmented';
type QualityMode = 'standard' | 'strict';

async function run() {
  const args = process.argv.slice(2);
  const voiceEngine = parseEnumArg<VoiceEngine>(args, '--voice', ['none', 'elevenlabs', 'openai', 'chatterbox']);
  const quality = parseEnumArg<QualityPreset>(args, '--quality', ['draft', 'yc']) ?? 'yc';
  const templateArg = parseEnumArg<TemplateArg>(args, '--template', ['auto', 'yc-saas', 'product-demo', 'founder-story']) ?? 'auto';
  const voiceMode = parseEnumArg<VoiceMode>(args, '--voice-mode', ['single', 'segmented']) ?? 'single';
  const qualityMode = parseEnumArg<QualityMode>(args, '--quality-mode', ['standard', 'strict']) ?? 'standard';
  const minQuality = parseNumberArg(args, '--min-quality', 74);
  const maxWarnings = parseNumberArg(args, '--max-warnings', qualityMode === 'strict' ? 0 : 3);
  const maxScriptAttempts = parseNumberArg(args, '--max-script-attempts', 4);
  const allowLowQuality = args.includes('--allow-low-quality');
  const autoFix = !args.includes('--no-autofix');
  const strictFlag = args.includes('--strict');
  const url = args.find((a) => !a.startsWith('--'));

  if (!url) {
    console.error(
      'Usage: npm run generate -- <url> [--voice=none|elevenlabs|openai|chatterbox] [--quality=draft|yc] ' +
      '[--template=auto|yc-saas|product-demo|founder-story] [--voice-mode=single|segmented] ' +
      '[--quality-mode=standard|strict] [--strict] [--max-warnings=3] [--min-quality=74] ' +
      '[--max-script-attempts=4] [--allow-low-quality] [--no-autofix]',
    );
    process.exit(1);
  }

  const effectiveQualityMode: QualityMode = strictFlag ? 'strict' : qualityMode;

  const outputName = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
  const outputDir = path.resolve(__dirname, '../../out');
  const publicDir = path.resolve(__dirname, '../../public');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, {recursive: true});

  console.log(`\n[1/5] Scraping ${url}...`);
  const scraped = await scrapeUrl(url);
  console.log(`  -> ${scraped.title}`);
  console.log(`  -> ${scraped.headings.length} headings, ${scraped.features.length} features found`);

  const templateSelection = selectTemplate(scraped, templateArg);
  console.log(`  -> Template: ${templateSelection.profile.id} (${templateSelection.reason})`);

  console.log(`\n[2/5] Generating script with quality gate...`);
  const {script, qualityReport, generationMode} = await generateScriptWithQualityGate({
    scraped,
    minQuality,
    maxWarnings,
    qualityMode: effectiveQualityMode,
    maxScriptAttempts,
    allowLowQuality,
    autoFix,
    templateArg,
  });

  console.log(`  -> Script mode: ${generationMode}`);
  console.log(`  -> Quality score: ${qualityReport.score}/${qualityReport.minScore} (passed=${qualityReport.passed})`);
  if (qualityReport.blockers.length > 0) {
    console.log(`  -> Blockers: ${qualityReport.blockers.join(' | ')}`);
  }
  if (qualityReport.warnings.length > 0) {
    console.log(`  -> Warnings: ${qualityReport.warnings.slice(0, 3).join(' | ')}`);
  }

  const fullNarration = script.narrationSegments.join(' ');
  console.log(`  -> Brand: ${script.brandName}`);
  console.log(`  -> Features: ${script.features.map((f) => f.appName).join(', ')}`);
  console.log(`  -> Narration words: ${countWords(fullNarration)}`);

  const scriptPath = path.join(outputDir, `${outputName}-script.json`);
  fs.writeFileSync(scriptPath, JSON.stringify({...script, narration: fullNarration}, null, 2));

  const qualityPath = path.join(outputDir, `${outputName}-quality.json`);
  fs.writeFileSync(
    qualityPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        url,
        template: templateSelection.profile.id,
        templateReason: templateSelection.reason,
        generationMode,
        qualityReport,
      },
      null,
      2,
    ),
  );
  console.log(`  -> Saved script: ${scriptPath}`);
  console.log(`  -> Saved quality report: ${qualityPath}`);

  console.log(`\n[3/5] Generating voice...`);
  const audioFilename = `${outputName}-voice.mp3`;
  const audioPath = path.join(outputDir, audioFilename);
  let voiceResult: {path: string; durationMs: number} | null = null;
  let estimatedDurationMs: number | null = null;
  let segmentDurationsMs: number[] | null = null;

  if (voiceEngine === 'none') {
    estimatedDurationMs = estimateNarrationDurationMs(fullNarration);
    console.log(`  -> Voice disabled. Using estimated duration ${estimatedDurationMs}ms`);
  } else {
    try {
      const voice = await generateVoiceWithResilience(script.narrationSegments, audioPath, voiceEngine, voiceMode);
      voiceResult = {path: voice.path, durationMs: voice.totalDurationMs};
      segmentDurationsMs = voice.segmentDurationsMs;
      console.log(`  -> Audio: ${voiceResult.path} (${voiceResult.durationMs}ms) via ${voice.engineUsed}`);
      console.log(`  -> Segment durations: [${segmentDurationsMs.join(', ')}]`);

      const publicAudioPath = path.join(publicDir, 'voice.mp3');
      fs.copyFileSync(audioPath, publicAudioPath);
      console.log('  -> Copied to public/voice.mp3');
    } catch (e: any) {
      console.warn(`  -> Voice generation failed: ${e.message}`);
      estimatedDurationMs = estimateNarrationDurationMs(fullNarration);
      console.warn(`  -> Falling back to estimated duration ${estimatedDurationMs}ms`);
    }
  }

  console.log(`\n[4/5] Rendering video with Remotion...`);
  const entryPoint = path.resolve(__dirname, '../index.ts');
  const bundled = await bundle({entryPoint, publicDir});

  const inputProps: Record<string, unknown> = {
    ...script,
    ...(voiceResult && {
      audioSrc: 'voice.mp3',
      audioDurationMs: voiceResult.durationMs,
    }),
    ...(!voiceResult && estimatedDurationMs && {
      audioDurationMs: estimatedDurationMs,
    }),
    ...(segmentDurationsMs && {segmentDurationsMs}),
  };

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

  console.log(`\n[5/5] Done`);
  console.log(`  Video: ${videoPath}`);
  console.log(`  Quality preset: ${quality}`);
  if (voiceResult) console.log('  Voice is baked into the video');
}

async function generateScriptWithQualityGate(args: {
  scraped: Awaited<ReturnType<typeof scrapeUrl>>;
  minQuality: number;
  maxWarnings: number;
  qualityMode: QualityMode;
  maxScriptAttempts: number;
  allowLowQuality: boolean;
  autoFix: boolean;
  templateArg: TemplateArg;
}): Promise<{script: ScriptResult; qualityReport: QualityReport; generationMode: 'model' | 'model+autofix' | 'fallback' | 'fallback+autofix'}> {
  const {scraped, minQuality, maxWarnings, qualityMode, maxScriptAttempts, allowLowQuality, autoFix, templateArg} = args;
  const templateSelection = selectTemplate(scraped, templateArg);
  const failOnWarnings = qualityMode === 'strict';

  let latestReport: QualityReport | null = null;
  let qualityFeedback: string[] = [];

  for (let attempt = 1; attempt <= maxScriptAttempts; attempt++) {
    let candidate: ScriptResult;
    try {
      candidate = await generateScript(scraped, {
        templateProfile: templateSelection.profile,
        qualityFeedback,
        maxRetries: 3,
      });
    } catch (e: any) {
      console.warn(`  -> Attempt ${attempt}/${maxScriptAttempts} model generation failed: ${e.message}`);
      qualityFeedback = [`Model generation error: ${e.message}`];
      continue;
    }

    candidate.sceneWeights = blendSceneWeights(candidate.sceneWeights, templateSelection.profile.sceneWeightHint);

    const report = scoreScriptQuality({
      script: candidate,
      scraped,
      template: templateSelection.profile,
      minScore: minQuality,
      maxWarnings,
      failOnWarnings,
    });

    latestReport = report;
    console.log(`  -> Attempt ${attempt}/${maxScriptAttempts} quality ${report.score}/${minQuality}`);

    if (report.passed) {
      return {
        script: candidate,
        qualityReport: report,
        generationMode: 'model',
      };
    }

    if (autoFix) {
      const fixed = autoFixScriptQuality(candidate, scraped);
      if (fixed.actions.length > 0) {
        console.log(`  -> Auto-fix applied: ${fixed.actions.join(' | ')}`);
      }
      const fixedReport = scoreScriptQuality({
        script: fixed.script,
        scraped,
        template: templateSelection.profile,
        minScore: minQuality,
        maxWarnings,
        failOnWarnings,
      });
      console.log(`  -> Auto-fix quality ${fixedReport.score}/${minQuality}`);
      if (fixedReport.passed) {
        return {
          script: fixed.script,
          qualityReport: fixedReport,
          generationMode: 'model+autofix',
        };
      }
      latestReport = fixedReport;
      qualityFeedback = toQualityFeedback(fixedReport);
      continue;
    }

    qualityFeedback = toQualityFeedback(report);
  }

  console.warn('  -> Model script did not pass quality gate, switching to deterministic fallback');
  const fallback = buildFallbackScript(scraped, templateSelection.profile);
  const fallbackReport = scoreScriptQuality({
    script: fallback,
    scraped,
    template: templateSelection.profile,
    minScore: minQuality,
    maxWarnings,
    failOnWarnings,
  });

  if (autoFix && !fallbackReport.passed) {
    const fixedFallback = autoFixScriptQuality(fallback, scraped);
    if (fixedFallback.actions.length > 0) {
      console.log(`  -> Fallback auto-fix applied: ${fixedFallback.actions.join(' | ')}`);
    }
    const fixedFallbackReport = scoreScriptQuality({
      script: fixedFallback.script,
      scraped,
      template: templateSelection.profile,
      minScore: minQuality,
      maxWarnings,
      failOnWarnings,
    });
    if (fixedFallbackReport.passed || allowLowQuality) {
      return {
        script: fixedFallback.script,
        qualityReport: fixedFallbackReport,
        generationMode: 'fallback+autofix',
      };
    }
    latestReport = fixedFallbackReport;
  }

  if (!fallbackReport.passed && !allowLowQuality) {
    const reason = [
      ...fallbackReport.blockers,
      ...fallbackReport.warnings,
      ...(latestReport ? ['Last model attempt warnings: ' + latestReport.warnings.join('; ')] : []),
    ]
      .filter(Boolean)
      .join(' | ');
    throw new Error(`Quality gate failed after model+fallback attempts: ${reason}`);
  }

  return {
    script: fallback,
    qualityReport: fallbackReport,
    generationMode: 'fallback',
  };
}

async function generateVoiceWithResilience(
  segments: string[],
  outputPath: string,
  requestedEngine: Exclude<VoiceEngine, 'none'> | undefined,
  mode: VoiceMode,
) {
  const engines: Exclude<VoiceEngine, 'none'>[] = requestedEngine
    ? [requestedEngine]
    : ['chatterbox', 'openai', 'elevenlabs'];

  const available = engines.filter((engine) => {
    if (engine === 'openai') return Boolean(process.env.openai_api_key);
    if (engine === 'elevenlabs') return Boolean(process.env.eleven_labs_api_key);
    return true;
  });

  if (available.length === 0) {
    throw new Error('No TTS providers available. Configure openai_api_key or eleven_labs_api_key.');
  }

  const errors: string[] = [];

  for (const engine of available) {
    try {
      return mode === 'segmented'
        ? await generateVoicePerSegment(segments, outputPath, engine)
        : await generateVoiceSingleCall(segments, outputPath, engine);
    } catch (e: any) {
      errors.push(`${engine}: ${e.message}`);
      console.warn(`  -> ${engine} failed, trying next engine`);
    }
  }

  throw new Error(errors.join(' | '));
}

function blendSceneWeights(generated: number[] | undefined, templateHint: number[]): number[] {
  if (!generated || generated.length !== 8) return templateHint;
  return generated.map((weight, idx) => Math.max(2, Math.round((weight + (templateHint[idx] ?? weight)) / 2)));
}

function parseEnumArg<T extends string>(args: string[], key: string, allowed: T[]): T | undefined {
  const raw = args.find((arg) => arg.startsWith(`${key}=`));
  if (!raw) return undefined;
  const value = raw.split('=')[1] as T;
  if (!allowed.includes(value)) {
    throw new Error(`Invalid value for ${key}: ${value}. Allowed: ${allowed.join(', ')}`);
  }
  return value;
}

function parseNumberArg(args: string[], key: string, fallback: number): number {
  const raw = args.find((arg) => arg.startsWith(`${key}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for ${key}: ${raw}`);
  return value;
}

function estimateNarrationDurationMs(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 30000;

  const words = countWords(trimmed);
  const sentences = (trimmed.match(/[.!?]+/g) || []).length;
  const baseMs = words * 375;
  const pauseMs = sentences * 250;
  return Math.max(30000, baseMs + pauseMs);
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

run().catch((e) => {
  console.error('Pipeline failed:', e.message);
  process.exit(1);
});
