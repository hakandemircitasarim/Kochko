/**
 * LEGACY ROUTE — param-forwarding redirect (ux-pass2).
 *
 * The one-thread conversation now lives INSIDE the Kochko tab (app/(tabs)/chat.tsx →
 * src/screens/ChatThreadScreen.tsx) so the tab bar survives chatting. Every historical
 * deep link and caller of `/chat/[sessionId]` lands here and is forwarded to the tab
 * with its params intact — the session id itself is dropped because #S1 guarantees a
 * single canonical thread the tab resolves on its own.
 */
import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export default function LegacyChatRedirect() {
  const { prefill, taskModeHint, openCamera, taskNonce } = useLocalSearchParams<{
    prefill?: string; taskModeHint?: string; openCamera?: string; taskNonce?: string;
  }>();

  useEffect(() => {
    const params: Record<string, string> = {};
    if (prefill) params.prefill = String(prefill);
    if (taskModeHint) params.taskModeHint = String(taskModeHint);
    if (openCamera) params.openCamera = String(openCamera);
    if (taskNonce) params.taskNonce = String(taskNonce);
    router.replace({ pathname: '/(tabs)/chat', params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
