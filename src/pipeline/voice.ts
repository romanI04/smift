import fs from 'fs';
import path from 'path';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// ElevenLabs voice: "Daniel" - deep British male, professional narration
const DEFAULT_ELEVENLABS_VOICE = 'onwK4e9ZLuTAKqWW03F9';

// OpenAI voice: "onyx" - deep, authoritative male
const DEFAULT_OPENAI_VOICE = 'onyx';

type Engine = 'elevenlabs' | 'openai';

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

  if (engine === 'openai') {
    return generateWithOpenAI(text, options);
  }
  return generateWithElevenLabs(text, options);
}

function detectEngine(): Engine {
  // Prefer ElevenLabs if key exists, fall back to OpenAI
  if (process.env.eleven_labs_api_key) return 'elevenlabs';
  if (process.env.openai_api_key) return 'openai';
  throw new Error('No TTS API key found. Set eleven_labs_api_key or openai_api_key');
}

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

async function saveAndMeasure(
  buffer: Buffer,
  text: string,
  outputPath: string,
): Promise<{path: string; durationMs: number}> {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(outputPath, buffer);

  // Get duration using ffprobe (if available)
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
    // Estimate: ~150ms per word
    durationMs = text.split(/\s+/).length * 150;
  }

  return {path: outputPath, durationMs};
}

// List available ElevenLabs voices
export async function listVoices(): Promise<Array<{voice_id: string; name: string}>> {
  const apiKey = process.env.eleven_labs_api_key;
  if (!apiKey) throw new Error('Missing eleven_labs_api_key in environment');

  const response = await fetch(`${ELEVENLABS_API}/voices`, {
    headers: {'xi-api-key': apiKey},
  });

  if (!response.ok) throw new Error(`Failed to list voices: ${response.status}`);
  const data = await response.json();
  return data.voices.map((v: any) => ({voice_id: v.voice_id, name: v.name}));
}
