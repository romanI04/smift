import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadManrope} from '@remotion/google-fonts/Manrope';

// Inter — clean, modern body text (used by Linear, Vercel, etc.)
const inter = loadInter('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

// Manrope — geometric display font, great for headlines
const manrope = loadManrope('normal', {
  weights: ['600', '700', '800'],
  subsets: ['latin'],
});

export const FONT_BODY = inter.fontFamily;
export const FONT_DISPLAY = manrope.fontFamily;
