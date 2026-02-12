import fs from 'fs';
import path from 'path';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

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
  // Chatterbox is best quality + free, but HuggingFace Spaces can go down.
  // ElevenLabs as reliable fallback if key available.
  if (process.env.eleven_labs_api_key) return 'elevenlabs';
  if (process.env.openai_api_key) return 'openai';
  return 'chatterbox';
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

// --- Chatterbox (Resemble AI via HuggingFace Spaces — FREE) ---

// --- Chatterbox (Resemble AI via HuggingFace Spaces — FREE) ---
// API: generate_tts_audio
// Inputs: [text, reference_audio, exaggeration, temperature, seed, cfg_pace, vad_trimming]
// Output: audio FileData with url

const CHATTERBOX_SPACE = 'https://resembleai-chatterbox.hf.space';
const CHATTERBOX_API = `${CHATTERBOX_SPACE}/gradio_api/call/generate_tts_audio`;

async function generateWithChatterbox(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  const chunks = chunkText(text, 290); // Space limit is 300 chars
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) console.log(`    -> Chunk ${i + 1}/${chunks.length}: "${chunks[i].slice(0, 50)}..."`);

    // POST to get event_id
    const callResponse = await fetch(CHATTERBOX_API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        data: [
          chunks[i],   // text
          null,         // reference audio (null = default voice)
          0.5,          // exaggeration (0.25-2, 0.5 = neutral)
          0.8,          // temperature
          0,            // seed (0 = random)
          0.5,          // cfg/pace
          false,        // ref VAD trimming
        ],
      }),
    });

    if (!callResponse.ok) {
      const error = await callResponse.text();
      throw new Error(`Chatterbox API error ${callResponse.status}: ${error}`);
    }

    const {event_id} = await callResponse.json();
    if (!event_id) throw new Error('No event_id returned from Chatterbox');

    // Poll SSE for result
    const audioUrl = await pollChatterboxResult(event_id);

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download Chatterbox audio: ${audioResponse.status}`);
    }
    audioBuffers.push(Buffer.from(await audioResponse.arrayBuffer()));
  }

  let finalBuffer: Buffer;
  if (audioBuffers.length === 1) {
    finalBuffer = audioBuffers[0];
  } else {
    finalBuffer = await concatenateAudioBuffers(audioBuffers, options.outputPath);
  }

  // Chatterbox outputs WAV — convert to MP3
  const wavPath = options.outputPath.replace('.mp3', '.wav');
  const outputDir = path.dirname(options.outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(wavPath, finalBuffer);

  const {execSync} = await import('child_process');
  execSync(`ffmpeg -i "${wavPath}" -codec:a libmp3lame -b:a 192k "${options.outputPath}" -y 2>/dev/null`);
  fs.unlinkSync(wavPath);

  return saveAndMeasure(fs.readFileSync(options.outputPath), text, options.outputPath);
}

async function pollChatterboxResult(eventId: string): Promise<string> {
  const sseUrl = `${CHATTERBOX_API}/${eventId}`;

  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise(r => setTimeout(r, 2000));

    try {
      const res = await fetch(sseUrl);
      const body = await res.text();

      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === 'event: complete' && i + 1 < lines.length) {
          const dataLine = lines[i + 1];
          if (dataLine.startsWith('data: ')) {
            const data = JSON.parse(dataLine.slice(6));
            if (Array.isArray(data) && data[0]) {
              const audioInfo = data[0];
              if (typeof audioInfo === 'string') return audioInfo;
              if (audioInfo.url) return audioInfo.url;
              if (audioInfo.path) return `${CHATTERBOX_SPACE}/gradio_api/file=${audioInfo.path}`;
            }
          }
        }
        if (lines[i] === 'event: error' && i + 1 < lines.length) {
          throw new Error(`Chatterbox generation error: ${lines[i + 1]}`);
        }
      }
    } catch (e: any) {
      if (e.message.startsWith('Chatterbox')) throw e;
    }
  }
  throw new Error('Chatterbox timed out after 3 minutes');
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
