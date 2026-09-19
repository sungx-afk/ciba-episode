import * as Speech from 'expo-speech';

export async function pronounceWord(
  word: string,
  options?: {
    accent?: 'en-US' | 'en-GB';
    rate?: number;
  }
) {
  if (!word) return;
  try {
    const isSpeaking = await Speech.isSpeakingAsync();
    if (isSpeaking) {
      await Speech.stop();
    }
    Speech.speak(word, {
      language: options?.accent || 'en-US',
      rate: options?.rate || 0.9,
      pitch: 1.0,
    });
  } catch (err) {
    console.warn('Pronunciation error:', err);
  }
}
