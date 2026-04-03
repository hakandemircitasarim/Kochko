/**
 * Voice Input Service
 * Spec 20.3, 3.1: Sesli giriş desteği.
 * Uses expo-speech for TTS and Audio recording for STT.
 * Speech-to-text processed server-side (Whisper API).
 */
import { Audio } from 'expo-av';
import { supabase } from '@/lib/supabase';

let recording: Audio.Recording | null = null;

/**
 * Start recording audio for speech-to-text.
 */
export async function startRecording(): Promise<boolean> {
  try {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return false;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording: rec } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    recording = rec;
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop recording and get the audio URI.
 */
export async function stopRecording(): Promise<string | null> {
  if (!recording) return null;

  try {
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    const uri = recording.getURI();
    recording = null;
    return uri;
  } catch {
    recording = null;
    return null;
  }
}

/**
 * Send audio to backend for transcription via Whisper API.
 * Returns transcribed text.
 */
export async function transcribeAudio(audioUri: string): Promise<string | null> {
  try {
    // Read audio file as blob
    const response = await fetch(audioUri);
    const blob = await response.blob();

    // Convert to base64
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve) => {
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
    });
    reader.readAsDataURL(blob);
    const audioBase64 = await base64Promise;

    // Send to backend edge function for transcription
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { audio_base64: audioBase64, transcribe_only: true },
    });

    if (error || !data?.transcription) return null;
    return data.transcription as string;
  } catch {
    return null;
  }
}

/**
 * Check if recording is currently active.
 */
export function isRecording(): boolean {
  return recording !== null;
}

/**
 * Convenience: record, stop, and transcribe in one flow.
 * Call startRecording first, then call this when user taps stop.
 * Returns the transcribed text ready to send to chat.
 */
export async function stopAndTranscribe(): Promise<{ text: string | null; audioUri: string | null }> {
  const uri = await stopRecording();
  if (!uri) return { text: null, audioUri: null };

  const text = await transcribeAudio(uri);
  return { text, audioUri: uri };
}
