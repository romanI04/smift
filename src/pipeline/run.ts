import {scrapeUrl} from './scraper';
import {generateScript} from './scriptgen';
import {generateVoice} from './voice';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load env from clawd root
dotenv.config({path: path.resolve(__dirname, '../../../../.env')});

async function run() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx ts-node src/pipeline/run.ts <url>');
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
  console.log(`  -> Narration: "${script.narration}"`);

  // Save script for debugging
  const scriptPath = path.join(outputDir, `${outputName}-script.json`);
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
  console.log(`  -> Script saved to ${scriptPath}`);

  console.log(`\n[3/4] Generating voice via ElevenLabs...`);
  const audioFilename = `${outputName}-voice.mp3`;
  const audioPath = path.join(outputDir, audioFilename);
  let voiceResult: {path: string; durationMs: number} | null = null;

  try {
    voiceResult = await generateVoice(script.narration, {outputPath: audioPath});
    console.log(`  -> Audio: ${voiceResult.path} (${voiceResult.durationMs}ms)`);

    // Copy voice to public/ so Remotion's staticFile() can find it
    const publicAudioPath = path.join(publicDir, 'voice.mp3');
    fs.copyFileSync(audioPath, publicAudioPath);
    console.log(`  -> Copied to public/voice.mp3 for Remotion`);
  } catch (e: any) {
    console.warn(`  -> Voice generation failed: ${e.message}`);
    console.warn(`  -> Continuing without voice...`);
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
  };

  // Remove narration from props (not a VideoProps field)
  delete inputProps.narration;

  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'SaasIntro',
    inputProps,
  });

  const videoPath = path.join(outputDir, `${outputName}.mp4`);
  await renderMedia({
    composition: {...composition, props: inputProps},
    serveUrl: bundled,
    codec: 'h264',
    outputLocation: videoPath,
    concurrency: 4,
  });

  console.log(`\n✓ Done!`);
  console.log(`  Video: ${videoPath}`);
  if (voiceResult) {
    console.log(`  Voice is baked into the video!`);
  }
}

run().catch((e) => {
  console.error('Pipeline failed:', e.message);
  process.exit(1);
});
