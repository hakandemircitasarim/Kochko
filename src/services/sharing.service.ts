/**
 * Social Sharing Service
 * Spec 13.4: Paylaşım özellikleri
 *
 * Handles sharing achievements, progress, milestones,
 * and invite links for viral growth.
 */
import { Share, Platform } from 'react-native';

export type ShareContentType = 'milestone' | 'weekly_report' | 'streak' | 'progress' | 'invite';

interface ShareContent {
  title: string;
  message: string;
}

/**
 * Share a milestone achievement.
 */
export async function shareMilestone(milestoneTitle: string, detail: string): Promise<void> {
  const content = buildShareContent('milestone', { title: milestoneTitle, detail });
  await Share.share({ title: content.title, message: content.message });
}

/**
 * Share weekly report summary.
 */
export async function shareWeeklyReport(compliance: number, weightChange: number): Promise<void> {
  const direction = weightChange < 0 ? 'verdim' : weightChange > 0 ? 'aldim' : 'sabit';
  const message = `Bu haftaki uyumum: %${compliance}. ${Math.abs(weightChange).toFixed(1)}kg ${direction}. #Kochko`;
  await Share.share({ title: 'Haftalik Raporum', message });
}

/**
 * Share streak count.
 */
export async function shareStreak(days: number): Promise<void> {
  const message = `${days} gundur Kochko ile disiplinli ilerliyorum! #Kochko #${days}GunSeri`;
  await Share.share({ title: 'Kochko Serim', message });
}

/**
 * Share progress summary.
 */
export async function shareProgress(
  startWeight: number,
  currentWeight: number,
  totalDays: number,
): Promise<void> {
  const lost = startWeight - currentWeight;
  const message = `Kochko ile ${totalDays} gunde ${Math.abs(lost).toFixed(1)}kg ${lost > 0 ? 'verdim' : 'aldim'}. #Kochko`;
  await Share.share({ title: 'Ilerleme Raporum', message });
}

/**
 * Share invite link for viral growth (Spec 13.4).
 */
export async function shareInviteLink(): Promise<void> {
  const message = 'Kochko ile kisisel AI kocumla saglikli yasam hedeflerime ulasiyorum. Sen de dene!';
  await Share.share({ title: 'Kochko - AI Yasam Tarzi Kocu', message });
}

function buildShareContent(type: ShareContentType, data: { title?: string; detail?: string }): ShareContent {
  switch (type) {
    case 'milestone':
      return { title: 'Kochko Basarim!', message: `${data.title}: ${data.detail} #Kochko` };
    case 'invite':
      return { title: 'Kochko', message: 'Kochko ile AI kocunu dene!' };
    default:
      return { title: 'Kochko', message: '#Kochko' };
  }
}
