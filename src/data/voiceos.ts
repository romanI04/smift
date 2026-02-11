import {VideoProps} from '../types';

export const voiceosData: VideoProps = {
  brandName: 'VoiceOS',
  brandUrl: 'voiceos.com',
  brandColor: '#000000',
  accentColor: '#2563EB',
  tagline: 'Voice is the new OS',
  hookLine1: 'your computer',
  hookLine2: "didn't need",
  hookKeyword: 'a keyboard',
  features: [
    {
      icon: 'mail',
      appName: 'Email',
      caption: 'Instantly replies for you',
      demoLines: [
        'Follow-Up on Project Update',
        'Hi Emily,',
        'Quick check, would it be easier to move our call to later this week or early next?',
        "Happy to work around what's best for you.",
        'Best, Jonah.',
      ],
    },
    {
      icon: 'ai',
      appName: 'Claude',
      caption: 'Thought to polished prompt',
      demoLines: [
        'Implement a comprehensive payment system',
        'that includes secure transaction handling,',
        'real time status updates, fraud detection',
        'mechanisms, multi currency support,',
        'and automatic receipt generation.',
      ],
    },
    {
      icon: 'social',
      appName: 'X',
      caption: 'Sounds just like you',
      demoLines: [
        "This is the kind of energy I'm bringing to 2026.",
      ],
    },
  ],
  integrations: [
    'Slack', 'Gmail', 'Notion', 'Telegram', 'Canva',
    'X', 'LinkedIn', 'GitHub', 'ChatGPT', 'Cursor',
    'Figma', 'Linear',
  ],
  ctaUrl: 'voiceos.com',
};
