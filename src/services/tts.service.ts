/**
 * Text-to-Speech Service
 * Spec 20.3: AI sesli yanıt desteği.
 *
 * Uses expo-speech for reading AI responses aloud.
 * Coach tone preference affects speech rate and pitch.
 */
import * as Speech from 'expo-speech';

interface TTSOptions {
  coachTone?: 'strict' | 'balanced' | 'gentle';
  language?: string;
}

/**
 * Speak text aloud using device TTS engine.
 */
export async function speak(text: string, options: TTSOptions = {}): Promise<void> {
  const { coachTone = 'balanced', language = 'tr-TR' } = options;

  // Adjust rate and pitch based on coach tone (Spec 4.2)
  let rate = 1.0;
  let pitch = 1.0;

  switch (coachTone) {
    case 'strict':
      rate = 1.1;  // Slightly faster, more direct
      pitch = 0.9; // Slightly deeper
      break;
    case 'gentle':
      rate = 0.9;  // Slightly slower, calmer
      pitch = 1.1; // Slightly higher, warmer
      break;
    case 'balanced':
    default:
      rate = 1.0;
      pitch = 1.0;
  }

  await Speech.speak(text, {
    language,
    rate,
    pitch,
    onDone: () => {},
    onError: () => {},
  });
}

/**
 * Stop any ongoing speech.
 */
export function stopSpeaking(): void {
  Speech.stop();
}

/**
 * Check if TTS is currently speaking.
 */
export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

/**
 * Convenience alias: speak text with default Turkish settings.
 * Simple API for components that don't need tone customization.
 */
export async function speakText(text: string): Promise<void> {
  return speak(text, { language: 'tr-TR' });
}

/**
 * Get available voices for the current locale.
 */
export async function getAvailableVoices(): Promise<Speech.Voice[]> {
  return Speech.getAvailableVoicesAsync();
}
