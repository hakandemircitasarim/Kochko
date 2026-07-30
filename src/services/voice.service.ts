/**
 * Voice Input Service
 * Spec 20.3, 3.1: Sesli giriş desteği.
 * Uses expo-speech for TTS and Audio recording for STT.
 * Speech-to-text processed server-side (Whisper API).
 */
import { Audio } from 'expo-av';
import { supabase } from '@/lib/supabase';
import { edgeHeaders } from '@/lib/edgeHeaders';

let recording: Audio.Recording | null = null;

/**
 * Start recording audio for speech-to-text.
 */
export async function startRecording(): Promise<boolean> {
  try {
    // ux-sweep (LOG-01, savunma katmanı): önceki oturumdan bayat bir Recording kaldıysa
    // (X ile yarıda çıkış vb.) önce boşalt — yoksa createAsync 'Only one Recording object'
    // ile patlar ve sesli giriş uygulama yeniden başlatılana dek kilitlenir.
    if (recording) {
      try { await recording.stopAndUnloadAsync(); } catch { /* zaten ölü olabilir */ }
      recording = null;
    }
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
export async function transcribeAudio(audioUri: string): Promise<{ text: string | null; premiumRequired: boolean }> {
  try {
    // Read audio file as blob
    const response = await fetch(audioUri);
    const blob = await response.blob();

    // Convert to base64
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      // Without an error/abort handler a failed read leaves the promise pending
      // forever, hanging the whole voice flow (#R4-13). Reject so the outer
      // try/catch returns null and the UI can recover.
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.onabort = () => reject(new Error('FileReader aborted'));
    });
    reader.readAsDataURL(blob);
    const audioBase64 = await base64Promise;

    // Send to backend edge function for transcription
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { audio_base64: audioBase64, transcribe_only: true },
      headers: edgeHeaders(),
    });

    if (error) {
      // Voice is a Premium feature — the server returns 403 PREMIUM_REQUIRED. Surface
      // that distinctly so the UI shows an upsell, not a misleading "failed" (#R7-3).
      const status = (error as { context?: { status?: number } })?.context?.status;
      return { text: null, premiumRequired: status === 403 };
    }
    if (!data?.transcription) return { text: null, premiumRequired: false };
    return { text: data.transcription as string, premiumRequired: false };
  } catch {
    return { text: null, premiumRequired: false };
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
export async function stopAndTranscribe(): Promise<{ text: string | null; audioUri: string | null; premiumRequired: boolean }> {
  const uri = await stopRecording();
  if (!uri) return { text: null, audioUri: null, premiumRequired: false };

  const { text, premiumRequired } = await transcribeAudio(uri);
  return { text, audioUri: uri, premiumRequired };
}
