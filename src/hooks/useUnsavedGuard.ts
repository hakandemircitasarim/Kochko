import { Alert } from 'react-native';
import { usePreventRemove, useNavigation } from '@react-navigation/native';

/**
 * FIX (ux-round3 #8): guards a form screen against silently losing unsaved edits.
 *
 * When `dirty` is true and the user tries to leave (Android hardware back, header
 * back button, swipe-back), a Turkish confirm is shown; the navigation only proceeds
 * on "Çık". Screens must clear their own `dirty` right after a successful save (e.g. by
 * updating the store baseline the dirty check compares against) so the intentional
 * post-save `router.back()` isn't intercepted.
 *
 * Note: relies on React Navigation's `beforeRemove` under expo-router. Header/hardware
 * back are covered reliably; iOS swipe-back coverage depends on react-native-screens.
 */
export function useUnsavedGuard(dirty: boolean) {
  const navigation = useNavigation();
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert(
      'Değişiklikleri bırak?',
      'Kaydetmediğin değişiklikler var. Çıkarsan kaybolacak.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Çık', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
      ],
    );
  });
}
