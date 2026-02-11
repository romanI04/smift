import {interpolate, Easing} from 'remotion';

// Custom easing curves for different motion intents
// These replace uniform springs with intentional, varied motion

// Slow start, confident finish — for hero elements entering
export const easeOutExpo = (t: number): number =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

// Gentle deceleration — for text and captions
export const easeOutCubic = (t: number): number =>
  1 - Math.pow(1 - t, 3);

// Dramatic slow-in, snap-out — for emphasis moments
export const easeInOutQuart = (t: number): number =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

// Very soft, floaty — for background elements
export const easeOutSine = (t: number): number =>
  Math.sin((t * Math.PI) / 2);

// Smooth interpolation with custom easing
export const smoothValue = (
  frame: number,
  startFrame: number,
  endFrame: number,
  from: number,
  to: number,
  easingFn: (t: number) => number = easeOutCubic,
): number => {
  if (frame <= startFrame) return from;
  if (frame >= endFrame) return to;
  const t = (frame - startFrame) / (endFrame - startFrame);
  return from + (to - from) * easingFn(t);
};

// Variable-speed typing: faster on common letters, pauses at punctuation
export const getTypingChars = (frame: number, startFrame: number, text: string): number => {
  if (frame <= startFrame) return 0;

  const elapsed = frame - startFrame;
  let charIndex = 0;
  let timeUsed = 0;

  for (let i = 0; i < text.length && timeUsed < elapsed; i++) {
    const char = text[i];
    // Pause longer at punctuation
    if (char === '.' || char === '!' || char === '?') {
      timeUsed += 3;
    } else if (char === ',') {
      timeUsed += 2;
    } else if (char === '\n') {
      timeUsed += 2.5;
    } else if (char === ' ') {
      timeUsed += 0.5;
    } else {
      timeUsed += 0.7;
    }
    if (timeUsed <= elapsed) {
      charIndex = i + 1;
    }
  }

  return Math.min(charIndex, text.length);
};

// Smooth noise for organic audio bar animation
export const smoothNoise = (frame: number, seed: number): number => {
  const x = frame * 0.08 + seed * 17.3;
  // Layered sine waves for organic feel
  return (
    Math.sin(x) * 0.3 +
    Math.sin(x * 2.3 + 1.7) * 0.25 +
    Math.sin(x * 0.7 + 3.1) * 0.2 +
    0.5
  );
};
