/**
 * Milestone Share Card Generator (Spec 13.4)
 *
 * Produces a shareable PNG for milestones like "5kg lost", streak achievements,
 * or weekly highlight. Uses expo-print to render HTML → PDF → first page image
 * (fallback: PDF file since iOS story share accepts both).
 */
import * as Print from 'expo-print';
import { shareImage } from './sharing.service';

export interface MilestoneCardData {
  title: string;
  subtitle?: string;
  value?: string; // e.g., "5kg", "30 gün"
  footer?: string;
  theme?: 'success' | 'streak' | 'milestone' | 'neutral';
}

const THEME_COLORS: Record<NonNullable<MilestoneCardData['theme']>, { bg: string; text: string; accent: string }> = {
  success:  { bg: '#D1FAE5', text: '#065F46', accent: '#10B981' },
  streak:   { bg: '#FEF3C7', text: '#92400E', accent: '#F59E0B' },
  milestone:{ bg: '#DBEAFE', text: '#1E3A8A', accent: '#3B82F6' },
  neutral:  { bg: '#F3F4F6', text: '#1F2937', accent: '#6B7280' },
};

/**
 * Render the card as HTML and print to file (PDF → share).
 * expo-print produces PDF; native share sheet accepts it for IG Stories on iOS
 * and WhatsApp / etc. on both platforms.
 */
export async function generateMilestoneCard(data: MilestoneCardData): Promise<string | null> {
  const theme = THEME_COLORS[data.theme ?? 'milestone'];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: 1080px 1920px; margin: 0; }
    html, body { margin: 0; padding: 0; width: 1080px; height: 1920px; font-family: -apple-system, Helvetica, Arial, sans-serif; }
    .wrap {
      width: 100%; height: 100%;
      background: linear-gradient(135deg, ${theme.bg} 0%, ${theme.accent}22 100%);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 120px 80px; box-sizing: border-box;
    }
    .badge {
      background: ${theme.accent}; color: white; padding: 12px 32px;
      border-radius: 999px; font-size: 32px; font-weight: 700; letter-spacing: 2px;
      margin-bottom: 48px;
    }
    .value { font-size: 180px; font-weight: 800; color: ${theme.text}; line-height: 1; }
    .title { font-size: 72px; font-weight: 700; color: ${theme.text}; margin-top: 32px; text-align: center; }
    .subtitle { font-size: 40px; color: ${theme.text}; opacity: 0.7; margin-top: 24px; text-align: center; }
    .footer { position: absolute; bottom: 80px; font-size: 32px; color: ${theme.text}; opacity: 0.6; }
    .brand { position: absolute; top: 80px; font-size: 42px; font-weight: 700; color: ${theme.accent}; letter-spacing: 4px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">KOCHKO</div>
    ${data.value ? `<div class="badge">${data.theme === 'streak' ? 'SERI' : data.theme === 'success' ? 'BASARI' : 'MILESTONE'}</div>` : ''}
    ${data.value ? `<div class="value">${data.value}</div>` : ''}
    <div class="title">${data.title}</div>
    ${data.subtitle ? `<div class="subtitle">${data.subtitle}</div>` : ''}
    <div class="footer">${data.footer ?? 'Kochko ile'}</div>
  </div>
</body>
</html>`;

  try {
    const { uri } = await Print.printToFileAsync({ html, width: 1080, height: 1920 });
    return uri;
  } catch {
    return null;
  }
}

/**
 * Convenience: generate and immediately share via native share sheet.
 */
export async function shareMilestoneCard(data: MilestoneCardData): Promise<boolean> {
  const uri = await generateMilestoneCard(data);
  if (!uri) return false;
  return shareImage(uri, 'Kochko milestone');
}
