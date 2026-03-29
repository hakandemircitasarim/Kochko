/**
 * Voice Input Service
 * Spec 3.1, 20.3: Sesli giriş desteği
 *
 * Records audio, sends to AI for transcription and parsing.
 * Uses expo-av for recording.
 */
import { readAsStringAsync } from 'expo-file-system';
import { supabase } from '@/lib/supabase';

export interface VoiceInputResult {
  transcript: string;
  success: boolean;
  error?: string;
}

/**
 * Send recorded audio to backend for transcription via AI.
 * The backend edge function handles speech-to-text conversion.
 */
export async function transcribeAudio(audioUri: string): Promise<VoiceInputResult> {
  try {
    const base64 = await readAsStringAsync(audioUri, {
      encoding: 'base64',
    });

    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: {
        message: '[voice_input]',
        audio_base64: base64,
        audio_format: 'wav',
      },
    });

    if (error) {
      return { transcript: '', success: false, error: error.message };
    }

    return {
      transcript: data?.transcript ?? data?.reply ?? '',
      success: true,
    };
  } catch (err) {
    return {
      transcript: '',
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Get audio recording settings optimized for speech.
 */
export function getRecordingOptions() {
  return {
    isMeteringEnabled: true,
    android: {
      extension: '.wav',
      outputFormat: 0, // DEFAULT
      audioEncoder: 0, // DEFAULT
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 128000,
    },
    ios: {
      extension: '.wav',
      outputFormat: 'linearPCM' as const,
      audioQuality: 96, // HIGH
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 128000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 128000,
    },
  };
}
