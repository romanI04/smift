import fs from 'fs';
import path from 'path';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// Default voice: "Adam" - clear, professional male voice
// Can be swapped for any ElevenLabs voice ID
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

interface VoiceOptions {
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  outputPath: string;
}

export async function generateVoice(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  const apiKey = process.env.eleven_labs_api_key;
  if (!apiKey) throw new Error('Missing eleven_labs_api_key in environment');

  const voiceId = options.voiceId || DEFAULT_VOICE_ID;

  const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
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

  // Save audio file
  const buffer = Buffer.from(await response.arrayBuffer());
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(options.outputPath, buffer);

  // Get duration using ffprobe (if available)
  let durationMs = 0;
  try {
    const {execSync} = await import('child_process');
    const result = execSync(
      `ffprobe -v quiet -print_format json -show_format "${options.outputPath}"`,
      {encoding: 'utf-8'},
    );
    const parsed = JSON.parse(result);
    durationMs = Math.round(parseFloat(parsed.format.duration) * 1000);
  } catch {
    // Estimate: ~150ms per word
    durationMs = text.split(/\s+/).length * 150;
  }

  return {path: options.outputPath, durationMs};
}

// List available voices
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
