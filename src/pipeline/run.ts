import {scrapeUrl} from './scraper';
import {generateScript} from './scriptgen';
import {generateVoice} from './voice';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'path';
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
  const fs = await import('fs');
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
  console.log(`  -> Script saved to ${scriptPath}`);

  console.log(`\n[3/4] Generating voice via ElevenLabs...`);
  const audioPath = path.join(outputDir, `${outputName}-voice.mp3`);
  let voiceResult;
  try {
    voiceResult = await generateVoice(script.narration, {outputPath: audioPath});
    console.log(`  -> Audio: ${voiceResult.path} (${voiceResult.durationMs}ms)`);
  } catch (e: any) {
    console.warn(`  -> Voice generation failed: ${e.message}`);
    console.warn(`  -> Continuing without voice...`);
    voiceResult = null;
  }

  console.log(`\n[4/4] Rendering video with Remotion...`);
  const entryPoint = path.resolve(__dirname, '../index.ts');
  const bundled = await bundle({entryPoint});

  const inputProps = script as unknown as Record<string, unknown>;
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
    console.log(`  Voice: ${voiceResult.path}`);
    console.log(`\n  Note: Voice track is separate. Merge with:`);
    console.log(`  ffmpeg -i "${videoPath}" -i "${voiceResult.path}" -c:v copy -c:a aac -shortest "${videoPath.replace('.mp4', '-with-voice.mp4')}"`);
  }
}

run().catch((e) => {
  console.error('Pipeline failed:', e.message);
  process.exit(1);
});
