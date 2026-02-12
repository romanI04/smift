import fs from 'fs';
import path from 'path';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const REPLICATE_API = 'https://api.replicate.com/v1';

// ElevenLabs voice: "Daniel" - deep British male, professional narration
const DEFAULT_ELEVENLABS_VOICE = 'onwK4e9ZLuTAKqWW03F9';

// OpenAI voice: "onyx" - deep, authoritative male
const DEFAULT_OPENAI_VOICE = 'onyx';

// Chatterbox voice: "Brian" - clear male narration
const DEFAULT_CHATTERBOX_VOICE = 'Brian';

type Engine = 'elevenlabs' | 'openai' | 'chatterbox';

interface VoiceOptions {
  engine?: Engine;
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  outputPath: string;
}

export async function generateVoice(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  const engine = options.engine || detectEngine();
  console.log(`  -> Using ${engine} TTS engine`);

  if (engine === 'openai') return generateWithOpenAI(text, options);
  if (engine === 'chatterbox') return generateWithChatterbox(text, options);
  return generateWithElevenLabs(text, options);
}

function detectEngine(): Engine {
  if (process.env.eleven_labs_api_key) return 'elevenlabs';
  if (process.env.REPLICATE_API_TOKEN) return 'chatterbox';
  if (process.env.openai_api_key) return 'openai';
  throw new Error('No TTS API key found. Set eleven_labs_api_key, REPLICATE_API_TOKEN, or openai_api_key');
}

// --- ElevenLabs v3 ---

async function generateWithElevenLabs(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  const apiKey = process.env.eleven_labs_api_key;
  if (!apiKey) throw new Error('Missing eleven_labs_api_key in environment');

  const voiceId = options.voiceId || DEFAULT_ELEVENLABS_VOICE;

  const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      voice_settings: {
        stability: options.stability ?? 0.5,
        similarity_boost: options.similarityBoost ?? 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${error}`);
  }

  return saveAndMeasure(Buffer.from(await response.arrayBuffer()), text, options.outputPath);
}

// --- OpenAI gpt-4o-mini-tts ---

async function generateWithOpenAI(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  const apiKey = process.env.openai_api_key;
  if (!apiKey) throw new Error('Missing openai_api_key in environment');

  const voice = options.voiceId || DEFAULT_OPENAI_VOICE;

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      input: text,
      voice,
      instructions: 'Speak in a professional, confident, slightly warm male tone suitable for a product demo narration video. Natural pacing, not rushed.',
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI TTS error ${response.status}: ${error}`);
  }

  return saveAndMeasure(Buffer.from(await response.arrayBuffer()), text, options.outputPath);
}

// --- Chatterbox (Resemble AI via Replicate) ---

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | null;
  error: string | null;
  urls: {get: string; cancel: string};
}

async function generateWithChatterbox(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('Missing REPLICATE_API_TOKEN in environment');

  const voice = options.voiceId || DEFAULT_CHATTERBOX_VOICE;

  // Chatterbox has a 500 char limit — chunk if needed
  const chunks = chunkText(text, 480);
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) console.log(`    -> Chunk ${i + 1}/${chunks.length}: "${chunks[i].slice(0, 40)}..."`);

    // Create prediction with sync wait
    const response = await fetch(
      `${REPLICATE_API}/models/resemble-ai/chatterbox-turbo/predictions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait',
        },
        body: JSON.stringify({
          input: {
            text: chunks[i],
            voice,
          },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Replicate API error ${response.status}: ${error}`);
    }

    let prediction: ReplicatePrediction = await response.json();

    // If still processing, poll until done
    if (prediction.status === 'starting' || prediction.status === 'processing') {
      prediction = await pollReplicate(prediction.urls.get, apiToken);
    }

    if (prediction.status !== 'succeeded' || !prediction.output) {
      throw new Error(`Chatterbox prediction failed: ${prediction.error || 'no output'}`);
    }

    // Download the WAV file from Replicate CDN
    const audioResponse = await fetch(prediction.output);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status}`);
    }
    audioBuffers.push(Buffer.from(await audioResponse.arrayBuffer()));
  }

  // If multiple chunks, concatenate WAV files via ffmpeg
  let finalBuffer: Buffer;
  if (audioBuffers.length === 1) {
    finalBuffer = audioBuffers[0];
  } else {
    finalBuffer = await concatenateAudioBuffers(audioBuffers, options.outputPath);
  }

  // Chatterbox outputs WAV — convert to MP3 for consistency
  const wavPath = options.outputPath.replace('.mp3', '.wav');
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(wavPath, finalBuffer);

  // Convert WAV to MP3
  const {execSync} = await import('child_process');
  execSync(`ffmpeg -i "${wavPath}" -codec:a libmp3lame -b:a 192k "${options.outputPath}" -y 2>/dev/null`);
  fs.unlinkSync(wavPath); // Clean up WAV

  return saveAndMeasure(fs.readFileSync(options.outputPath), text, options.outputPath);
}

async function pollReplicate(pollUrl: string, apiToken: string): Promise<ReplicatePrediction> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(pollUrl, {
      headers: {'Authorization': `Bearer ${apiToken}`},
    });
    const prediction: ReplicatePrediction = await res.json();
    if (prediction.status === 'succeeded') return prediction;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Chatterbox failed: ${prediction.error}`);
    }
  }
  throw new Error('Chatterbox timed out after 60s');
}

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > maxChars && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function concatenateAudioBuffers(buffers: Buffer[], outputPath: string): Promise<Buffer> {
  const {execSync} = await import('child_process');
  const tmpDir = path.dirname(outputPath);
  const tmpPaths: string[] = [];

  // Write each chunk as a temp WAV
  for (let i = 0; i < buffers.length; i++) {
    const tmpPath = path.join(tmpDir, `_chunk_${i}.wav`);
    fs.writeFileSync(tmpPath, buffers[i]);
    tmpPaths.push(tmpPath);
  }

  // Write concat list file
  const listPath = path.join(tmpDir, '_concat_list.txt');
  fs.writeFileSync(listPath, tmpPaths.map(p => `file '${p}'`).join('\n'));

  // Concatenate
  const concatPath = path.join(tmpDir, '_concat_output.wav');
  execSync(`ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}" -y 2>/dev/null`);

  const result = fs.readFileSync(concatPath);

  // Cleanup
  for (const p of tmpPaths) fs.unlinkSync(p);
  fs.unlinkSync(listPath);
  fs.unlinkSync(concatPath);

  return result;
}

// --- Shared utilities ---

async function saveAndMeasure(
  buffer: Buffer,
  text: string,
  outputPath: string,
): Promise<{path: string; durationMs: number}> {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});

  // Only write if not already written (chatterbox handles its own write)
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath).length !== buffer.length) {
    fs.writeFileSync(outputPath, buffer);
  }

  let durationMs = 0;
  try {
    const {execSync} = await import('child_process');
    const result = execSync(
      `ffprobe -v quiet -print_format json -show_format "${outputPath}"`,
      {encoding: 'utf-8'},
    );
    const parsed = JSON.parse(result);
    durationMs = Math.round(parseFloat(parsed.format.duration) * 1000);
  } catch {
    durationMs = text.split(/\s+/).length * 150;
  }

  return {path: outputPath, durationMs};
}
