/**
 * Social Sharing Service
 * Spec 13.4: İlerleme ve başarı paylaşımı.
 *
 * Handles sharing progress, milestones, and reports
 * via native share sheet (Instagram, WhatsApp, etc.)
 */
import { Share, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

interface ShareContent {
  title: string;
  message: string;
  url?: string;
}

/**
 * Share a milestone achievement.
 * Spec 13.4: Hassas veriler otomatik gizlenir.
 */
export async function shareMilestone(
  achievementTitle: string,
  achievementDesc: string
): Promise<boolean> {
  return shareContent({
    title: `Kochko - ${achievementTitle}`,
    message: `${achievementTitle}\n${achievementDesc}\n\nKochko ile yasam tarzimi yonetiyorum.`,
  });
}

/**
 * Share weekly progress summary.
 * Only shares non-sensitive stats (no weight/BMI/medical).
 */
export async function shareWeeklyProgress(
  complianceScore: number,
  streak: number,
  weeklyHighlight: string
): Promise<boolean> {
  return shareContent({
    title: 'Kochko Haftalik Ilerleme',
    message: `Bu hafta %${complianceScore} uyum sagladim.\n${streak} gunluk seri devam ediyor.\n${weeklyHighlight}\n\nKochko ile beraber.`,
  });
}

/**
 * Share a streak milestone.
 */
export async function shareStreak(days: number): Promise<boolean> {
  return shareContent({
    title: `${days} Gun Seri!`,
    message: `Kochko ile ${days} gun arka arkaya kayit girdim.\n\n#Kochko #SaglikliYasam`,
  });
}

/**
 * Invite a friend to Kochko.
 * Spec 13.4: Viral growth channel.
 */
export async function inviteFriend(): Promise<boolean> {
  return shareContent({
    title: 'Kochko — AI Yaşam Tarzı Koçun',
    message: 'Beslenme ve antrenman planlarımı AI koç ile yönetiyorum. Sen de dene!',
    // url: 'https://kochko.app/invite' // uncomment when URL is ready
  });
}

async function shareContent(content: ShareContent): Promise<boolean> {
  try {
    const result = await Share.share({
      title: content.title,
      message: content.message,
      ...(content.url && Platform.OS === 'ios' ? { url: content.url } : {}),
    });
    return result.action === Share.sharedAction;
  } catch {
    return false;
  }
}

/**
 * Share an image file (e.g., milestone card / tempo chart screenshot) via
 * native share sheet — Instagram Stories, WhatsApp, etc.
 * Requires expo-sharing which is already a dependency.
 */
export async function shareImage(fileUri: string, dialogTitle?: string): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return false;
    }
    await Sharing.shareAsync(fileUri, {
      dialogTitle: dialogTitle ?? 'Kochko ile paylas',
      mimeType: 'image/png',
    });
    return true;
  } catch {
    return false;
  }
}
