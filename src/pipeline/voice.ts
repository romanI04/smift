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

interface PerSegmentResult {
  path: string;
  totalDurationMs: number;
  segmentDurationsMs: number[];
  engineUsed: Engine;
}

/**
 * Generate voice for each narration segment individually, measure exact durations,
 * then concatenate into a single clean MP3. Returns per-segment timing for exact sync.
 *
 * Key: NO per-segment mastering. Raw segments are measured for timing, then
 * concatenated with re-encoding (eliminates MP3 boundary clicks) and mastered ONCE.
 */
export async function generateVoicePerSegment(
  segments: string[],
  outputPath: string,
  requestedEngine?: Engine,
): Promise<PerSegmentResult> {
  const engine = requestedEngine || detectEngine();
  console.log(`  -> Per-segment voice generation with ${engine} (${segments.length} segments)`);

  const {execSync} = await import('child_process');
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});

  // Generate raw segments (no mastering)
  const prevSkip = process.env.SMIFT_SKIP_AUDIO_MASTERING;
  process.env.SMIFT_SKIP_AUDIO_MASTERING = '1';

  const segmentPaths: string[] = [];
  const segmentDurationsMs: number[] = [];

  try {
    if (engine === 'chatterbox') {
      const replicateKey = process.env.replicate_key;
      if (replicateKey) {
        const results = await generateSegmentsReplicateParallel(segments, outputDir, replicateKey);
        for (const r of results) {
          segmentPaths.push(r.path);
          segmentDurationsMs.push(r.durationMs);
        }
      } else {
        for (let i = 0; i < segments.length; i++) {
          const segPath = path.join(outputDir, `_seg_${i}.mp3`);
          const result = await generateVoice(segments[i], {outputPath: segPath, engine});
          segmentPaths.push(segPath);
          segmentDurationsMs.push(result.durationMs);
          console.log(`     Segment ${i}: ${result.durationMs}ms`);
        }
      }
    } else {
      for (let i = 0; i < segments.length; i++) {
        const segPath = path.join(outputDir, `_seg_${i}.mp3`);
        const result = await generateVoice(segments[i], {outputPath: segPath, engine});
        segmentPaths.push(segPath);
        segmentDurationsMs.push(result.durationMs);
        console.log(`     Segment ${i}: ${result.durationMs}ms`);
      }
    }
  } finally {
    // Restore mastering flag
    if (prevSkip === undefined) delete process.env.SMIFT_SKIP_AUDIO_MASTERING;
    else process.env.SMIFT_SKIP_AUDIO_MASTERING = prevSkip;
  }

  // Decode all segments to WAV for clean concatenation
  const wavPaths: string[] = [];
  for (let i = 0; i < segmentPaths.length; i++) {
    const wavPath = path.join(outputDir, `_seg_${i}_raw.wav`);
    execSync(`ffmpeg -i "${segmentPaths[i]}" -ar 48000 -ac 1 -acodec pcm_s16le "${wavPath}" -y 2>/dev/null`);
    wavPaths.push(wavPath);
  }

  // Concatenate WAVs with 30ms crossfade between segments to eliminate clicks
  const concatWav = path.join(outputDir, '_concat.wav');
  if (wavPaths.length === 1) {
    fs.copyFileSync(wavPaths[0], concatWav);
  } else {
    // Build ffmpeg filter: chain acrossfade between each pair
    const inputs = wavPaths.map((p, i) => `-i "${p}"`).join(' ');
    let filter = '';
    const cf = 0.03; // 30ms crossfade — just enough to kill clicks, too short to affect timing
    for (let i = 0; i < wavPaths.length - 1; i++) {
      const inA = i === 0 ? '[0]' : `[a${i}]`;
      const inB = `[${i + 1}]`;
      const out = i === wavPaths.length - 2 ? '[out]' : `[a${i + 1}]`;
      filter += `${inA}${inB}acrossfade=d=${cf}:c1=tri:c2=tri${out};`;
    }
    filter = filter.slice(0, -1); // remove trailing semicolon
    execSync(
      `ffmpeg ${inputs} -filter_complex "${filter}" -map "[out]" -ar 48000 -ac 1 -acodec pcm_s16le "${concatWav}" -y 2>/dev/null`,
    );
  }

  // Encode to MP3 and master ONCE
  execSync(
    `ffmpeg -i "${concatWav}" -ar 48000 -ac 2 -codec:a libmp3lame -q:a 2 "${outputPath}" -y 2>/dev/null`,
  );
  await masterAudio(outputPath);

  // Cleanup temp files
  for (const p of segmentPaths) if (fs.existsSync(p)) fs.unlinkSync(p);
  for (const p of wavPaths) if (fs.existsSync(p)) fs.unlinkSync(p);
  if (fs.existsSync(concatWav)) fs.unlinkSync(concatWav);

  const totalDurationMs = segmentDurationsMs.reduce((a, b) => a + b, 0);
  console.log(`  -> Total voice: ${totalDurationMs}ms across ${segments.length} segments`);

  return {path: outputPath, totalDurationMs, segmentDurationsMs, engineUsed: engine};
}

/**
 * Generate the full narration in a single TTS call for consistent pacing,
 * then estimate per-segment durations via word-count proportional splitting.
 */
export async function generateVoiceSingleCall(
  segments: string[],
  outputPath: string,
  requestedEngine?: Engine,
): Promise<PerSegmentResult> {
  const engine = requestedEngine || detectEngine();
  console.log(`  -> Single-call voice generation with ${engine}`);

  const fullText = segments.join(' ');
  const result = await generateVoice(fullText, {outputPath, engine});

  // Proportional split: each segment's duration = (segment words / total words) * total duration
  const segmentWordCounts = segments.map(s => s.trim().split(/\s+/).filter(Boolean).length);
  const totalWords = segmentWordCounts.reduce((a, b) => a + b, 0);
  const segmentDurationsMs = segmentWordCounts.map(wc =>
    Math.round((wc / totalWords) * result.durationMs),
  );

  // Adjust rounding to match total exactly
  const sumMs = segmentDurationsMs.reduce((a, b) => a + b, 0);
  if (sumMs !== result.durationMs) {
    segmentDurationsMs[segmentDurationsMs.length - 1] += result.durationMs - sumMs;
  }

  console.log(`  -> Total voice: ${result.durationMs}ms, proportional segments: [${segmentDurationsMs.join(', ')}]`);

  return {
    path: outputPath,
    totalDurationMs: result.durationMs,
    segmentDurationsMs,
    engineUsed: engine,
  };
}

/**
 * Fire all Replicate predictions in parallel, then poll them all.
 * Much faster than sequential (~3s per segment vs ~3s * 8 = 24s).
 */
async function generateSegmentsReplicateParallel(
  segments: string[],
  outputDir: string,
  apiKey: string,
): Promise<{path: string; durationMs: number}[]> {
  const {execSync} = await import('child_process');

  // 1. Create predictions sequentially (Replicate free tier: burst of 1, 6/min)
  console.log(`    -> Creating ${segments.length} Replicate predictions sequentially...`);
  const predictions: {index: number; pollUrl: string; text: string}[] = [];

  for (let i = 0; i < segments.length; i++) {
    // Wait between requests to avoid rate limiting
    if (i > 0) await new Promise(r => setTimeout(r, 1500));

    let created = false;
    for (let retry = 0; retry < 5; retry++) {
      const res = await fetch('https://api.replicate.com/v1/models/resemble-ai/chatterbox/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            prompt: segments[i],
            exaggeration: 0.3,
            cfg_weight: 0.5,
          },
        }),
      });
      if (res.status === 429) {
        console.log(`    -> Rate limited on segment ${i}, waiting 15s (retry ${retry + 1})...`);
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Replicate create failed for segment ${i}: ${res.status} ${err}`);
      }
      const prediction = await res.json();
      predictions.push({index: i, pollUrl: prediction.urls?.get as string, text: segments[i]});
      console.log(`    -> Segment ${i} submitted`);
      created = true;
      break;
    }
    if (!created) {
      throw new Error(`Replicate create failed for segment ${i} after 5 retries (rate limited)`);
    }
  }

  // 2. Poll all predictions until done
  console.log(`    -> Polling ${predictions.length} predictions...`);
  const results: {index: number; audioUrl: string}[] = [];
  const pending = new Set(predictions.map(p => p.index));

  for (let attempt = 0; attempt < 90 && pending.size > 0; attempt++) {
    await new Promise(r => setTimeout(r, 2000));

    for (const pred of predictions) {
      if (!pending.has(pred.index)) continue;

      try {
        const pollRes = await fetch(pred.pollUrl, {
          headers: {'Authorization': `Token ${apiKey}`},
        });
        const raw = await pollRes.text();
        const result = JSON.parse(raw.replace(/[\x00-\x1f]/g, ' '));

        if (result.status === 'succeeded' && result.output) {
          results.push({index: pred.index, audioUrl: result.output});
          pending.delete(pred.index);
          console.log(`     Segment ${pred.index} done (${pending.size} remaining)`);
        } else if (result.status === 'failed') {
          throw new Error(`Segment ${pred.index} failed: ${result.error}`);
        }
      } catch (e: any) {
        if (e.message.startsWith('Segment')) throw e;
      }
    }
  }

  if (pending.size > 0) {
    throw new Error(`Timed out waiting for segments: ${[...pending].join(', ')}`);
  }

  // 3. Download all audio, convert WAV→MP3, measure durations
  results.sort((a, b) => a.index - b.index);
  const output: {path: string; durationMs: number}[] = [];

  for (const r of results) {
    const audioRes = await fetch(r.audioUrl);
    if (!audioRes.ok) throw new Error(`Failed to download segment ${r.index}: ${audioRes.status}`);

    const wavPath = path.join(outputDir, `_seg_${r.index}.wav`);
    const mp3Path = path.join(outputDir, `_seg_${r.index}.mp3`);
    fs.writeFileSync(wavPath, Buffer.from(await audioRes.arrayBuffer()));

    // Convert WAV → MP3 (no mastering — done once on final concat)
    execSync(`ffmpeg -i "${wavPath}" -ar 48000 -ac 2 -codec:a libmp3lame -q:a 2 "${mp3Path}" -y 2>/dev/null`);
    fs.unlinkSync(wavPath);

    // Measure duration
    let durationMs = 0;
    try {
      const probe = execSync(
        `ffprobe -v quiet -print_format json -show_format "${mp3Path}"`,
        {encoding: 'utf-8'},
      );
      durationMs = Math.round(parseFloat(JSON.parse(probe).format.duration) * 1000);
    } catch {
      durationMs = segments[r.index].split(/\s+/).length * 150;
    }

    output.push({path: mp3Path, durationMs});
    console.log(`     Segment ${r.index}: ${durationMs}ms — "${segments[r.index].slice(0, 40)}..."`);
  }

  return output;
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
  // ElevenLabs — best quality. Chatterbox as fallback.
  if (process.env.eleven_labs_api_key) return 'elevenlabs';
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

  // OpenAI TTS is already broadcast-quality — skip re-mastering to avoid artifacts
  return saveAndMeasure(Buffer.from(await response.arrayBuffer()), text, options.outputPath, true);
}

// --- Chatterbox (Resemble AI via HuggingFace Spaces — FREE) ---

// --- Chatterbox (Resemble AI via HuggingFace Spaces — FREE) ---
// Tries multiple spaces for reliability (Zero GPU tier can go down)

const CHATTERBOX_SPACES = [
  {url: 'https://resembleai-chatterbox.hf.space', api: 'generate_tts_audio', params: 7},
  {url: 'https://freddyaboulton-chatterbox.hf.space', api: 'generate_tts_audio', params: 6},
  {url: 'https://evalstate-chatterbox.hf.space', api: 'generate_tts_audio', params: 6},
];

async function callChatterboxSpace(text: string): Promise<{spaceUrl: string; eventId: string; apiPath: string}> {
  let nullErrorCount = 0;
  for (const space of CHATTERBOX_SPACES) {
    const apiUrl = `${space.url}/gradio_api/call/${space.api}`;
    const data = space.params === 7
      ? [text, null, 0.5, 0.8, 0, 0.5, false]
      : [text, null, 0.5, 0.8, 0, 0.5];

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({data}),
      });
      if (!res.ok) continue;
      const {event_id} = await res.json();
      if (!event_id) continue;

      // Quick check: poll once to see if space is alive
      await new Promise(r => setTimeout(r, 3000));
      const checkRes = await fetch(`${apiUrl}/${event_id}`);
      const checkBody = await checkRes.text();
      if (checkBody.includes('event: error')) {
        if (checkBody.includes('data: null')) {
          nullErrorCount += 1;
        }
        console.log(`    -> Space ${space.url} returned error, trying next...`);
        continue;
      }
      // Space is alive — return for full polling
      return {spaceUrl: space.url, eventId: event_id, apiPath: apiUrl};
    } catch {
      console.log(`    -> Space ${space.url} unreachable, trying next...`);
      continue;
    }
  }
  if (nullErrorCount >= 2) {
    throw new Error(
      'Chatterbox Spaces are reachable but rejecting generation (likely HuggingFace Zero GPU quota exhausted). ' +
      'Try later, or use --voice=openai / --voice=elevenlabs to keep testing.',
    );
  }
  throw new Error('All Chatterbox HuggingFace Spaces are currently unavailable. Try again later.');
}

async function generateWithChatterbox(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  // Try Replicate first (fast, reliable), fall back to HF Spaces
  const replicateKey = process.env.replicate_key;
  if (replicateKey) {
    try {
      return await generateWithChatterboxReplicate(text, options, replicateKey);
    } catch (e: any) {
      console.log(`    -> Replicate failed: ${e.message}, trying HF Spaces...`);
    }
  }
  return generateWithChatterboxHF(text, options);
}

// --- Chatterbox via Replicate API (fast, paid) ---

async function generateWithChatterboxReplicate(
  text: string,
  options: VoiceOptions,
  apiKey: string,
): Promise<{path: string; durationMs: number}> {
  const chunks = chunkText(text, 500); // Replicate handles longer chunks
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) console.log(`    -> Chunk ${i + 1}/${chunks.length}: "${chunks[i].slice(0, 50)}..."`);

    // Create prediction
    const createRes = await fetch('https://api.replicate.com/v1/models/resemble-ai/chatterbox/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: chunks[i],
          exaggeration: 0.3,
          cfg_weight: 0.5,
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Replicate create failed ${createRes.status}: ${err}`);
    }

    const prediction = await createRes.json();
    const predictionUrl = prediction.urls?.get;
    if (!predictionUrl) throw new Error('No prediction URL returned');

    if (i === 0) console.log(`    -> Using Replicate (resemble-ai/chatterbox)`);

    // Poll for completion
    let audioUrl: string | null = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(r => setTimeout(r, 2000));

      const pollRes = await fetch(predictionUrl, {
        headers: {'Authorization': `Token ${apiKey}`},
      });
      const raw = await pollRes.text();
      const result = JSON.parse(raw.replace(/[\x00-\x1f]/g, ' '));

      if (result.status === 'succeeded' && result.output) {
        audioUrl = result.output;
        break;
      }
      if (result.status === 'failed') {
        throw new Error(`Replicate prediction failed: ${result.error}`);
      }
    }

    if (!audioUrl) throw new Error('Replicate prediction timed out');

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download Replicate audio: ${audioResponse.status}`);
    }
    audioBuffers.push(Buffer.from(await audioResponse.arrayBuffer()));
  }

  return finishChatterboxAudio(audioBuffers, text, options);
}

// --- Chatterbox via HuggingFace Spaces (free, unreliable) ---

async function generateWithChatterboxHF(
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
  const chunks = chunkText(text, 290);
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1) console.log(`    -> Chunk ${i + 1}/${chunks.length}: "${chunks[i].slice(0, 50)}..."`);

    const {spaceUrl, eventId, apiPath} = await callChatterboxSpace(chunks[i]);
    if (i === 0) console.log(`    -> Using HF Space: ${spaceUrl}`);

    const audioUrl = await pollChatterboxResult(eventId, apiPath);

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download Chatterbox audio: ${audioResponse.status}`);
    }
    audioBuffers.push(Buffer.from(await audioResponse.arrayBuffer()));
  }

  return finishChatterboxAudio(audioBuffers, text, options);
}

// --- Shared: concatenate chunks + convert WAV → MP3 ---

async function finishChatterboxAudio(
  audioBuffers: Buffer[],
  text: string,
  options: VoiceOptions,
): Promise<{path: string; durationMs: number}> {
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
  execSync(`ffmpeg -i "${wavPath}" -ar 48000 -ac 2 -codec:a libmp3lame -q:a 2 "${options.outputPath}" -y 2>/dev/null`);
  fs.unlinkSync(wavPath);

  return saveAndMeasure(fs.readFileSync(options.outputPath), text, options.outputPath);
}

async function pollChatterboxResult(eventId: string, apiPath: string): Promise<string> {
  const sseUrl = `${apiPath}/${eventId}`;

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
              if (audioInfo.path) {
                // Extract base URL from apiPath (e.g. https://x.hf.space/gradio_api/call/fn -> https://x.hf.space)
                const baseUrl = apiPath.split('/gradio_api/')[0];
                return `${baseUrl}/gradio_api/file=${audioInfo.path}`;
              }
            }
          }
        }
        if (lines[i] === 'event: error' && i + 1 < lines.length) {
          const payload = lines[i + 1].replace(/^data:\s*/, '').trim();
          if (payload === 'null') {
            throw new Error(
              'Chatterbox is reachable but rejected generation (common on HuggingFace Zero GPU quota exhaustion). ' +
              'Try later, or run with --voice=openai / --voice=elevenlabs for now.',
            );
          }
          throw new Error(`Chatterbox generation error: ${payload}`);
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
  skipMastering = false,
): Promise<{path: string; durationMs: number}> {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});

  // Only write if not already written (chatterbox handles its own write)
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath).length !== buffer.length) {
    fs.writeFileSync(outputPath, buffer);
  }

  if (!skipMastering) await masterAudio(outputPath);

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

async function masterAudio(outputPath: string): Promise<void> {
  if (process.env.SMIFT_SKIP_AUDIO_MASTERING === '1') return;
  if (!outputPath.endsWith('.mp3')) return;

  try {
    const {execSync} = await import('child_process');
    const tmpPath = outputPath.replace(/\.mp3$/, '.master.mp3');
    execSync(
      `ffmpeg -i "${outputPath}" -af "highpass=f=70,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=11" ` +
      `-ar 48000 -ac 2 -codec:a libmp3lame -q:a 2 "${tmpPath}" -y 2>/dev/null`,
    );
    if (fs.existsSync(tmpPath)) {
      fs.renameSync(tmpPath, outputPath);
    }
  } catch {
    // If mastering fails we still keep original audio.
  }
}
