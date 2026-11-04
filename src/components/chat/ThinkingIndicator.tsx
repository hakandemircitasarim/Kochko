/**
 * ThinkingIndicator — the "Kochko is working on it" bubble.
 *
 * Replaces a frozen "Kochko yazıyor" with a narrated wait: an icon + line that change as the turn
 * progresses (stages from src/lib/thinking-stages.ts, which mirror the server pipeline), a breathing
 * halo behind the mascot, and — for long turns like a 7-day plan — a progress bar and step pips.
 * The reply itself is never streamed (the safety nets need the full text first); this is what
 * makes a 25-second plan feel like work being done instead of a dead spinner.
 *
 * Reduce-motion: loops and transitions are skipped, the line simply swaps.
 *
 * 2026-11-04 (Duolingo dili): sohbet balonlarıyla aynı konuşmacı kalıbı (CoachSpeech) —
 * Koçko avatarı (+ nefes alan hale) balonun DIŞINDA solda, balon 2px gri çerçeveli ve
 * avatara bakan kuyruklu. Uzun turların elle yazılmış iz+dolgu çubuğu (+ JS sürücülü
 * genişlik ve parıltı döngüsü) ortak ProgressBar'a geçti: aynı asimptotik tahmin, dolarak
 * gelen dolgu + parlak şerit; bir döngü eksik.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, Text, type ViewStyle } from 'react-native';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { Dot } from '@/components/chat/TypingIndicator';
import { CoachAvatar, SpeechTail, bodyEdge, COACH_AVATAR, BUBBLE_RADIUS, BUBBLE_TAIL_RADIUS, BUBBLE_BORDER } from '@/components/chat/CoachSpeech';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import {
  type ThinkingScript, type TurnKind, stageIndexAt, estimatedProgress, coreStageCount, buildThinkingScript,
} from '@/lib/thinking-stages';
import { useProfileStore } from '@/stores/profile.store';
import { deriveNutritionTargets } from '@/lib/nutrition-targets';

const TICK_MS = 250;

interface Props {
  script: ThinkingScript;
  /** Epoch ms when the turn was sent — the stage clock runs from here. */
  startedAt: number;
  /** e.g. { alignSelf: 'center' } on report screens. */
  style?: ViewStyle;
}

/**
 * Self-clocked variant for screens that just know "something of kind X is running" (report and
 * menu generation): the narration starts when this mounts. Mount it only while busy.
 */
export function ThinkingFor({ kind, style }: { kind: TurnKind; style?: ViewStyle }) {
  const profile = useProfileStore((s) => s.profile);
  const [state] = useState(() => {
    const t = deriveNutritionTargets(profile);
    return { script: buildThinkingScript(kind, { calorieTarget: t.calorieTargetMid > 0 ? t.calorieTargetMid : null }, Math.random()), startedAt: Date.now() };
  });
  return <ThinkingIndicator script={state.script} startedAt={state.startedAt} style={style} />;
}

export function ThinkingIndicator({ script, startedAt, style }: Props) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const edge = bodyEdge(colors, isDark);

  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  useEffect(() => {
    setElapsed(Math.max(0, Date.now() - startedAt));
    const id = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), TICK_MS);
    return () => clearInterval(id);
  }, [startedAt]);

  const targetIdx = stageIndexAt(script, elapsed);
  const [shownIdx, setShownIdx] = useState(targetIdx);
  const stage = script.stages[Math.min(shownIdx, script.stages.length - 1)];

  // ── Enter: fade + rise once on mount ──
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { enter.setValue(1); return; }
    Animated.timing(enter, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, reduceMotion]);

  // ── Halo: breathing ring behind the mascot (slow + soft on calm/support turns) ──
  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { halo.setValue(0); return; }
    const period = script.calm ? 2600 : 1300;
    const loop = Animated.loop(Animated.timing(halo, { toValue: 1, duration: period, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => { loop.stop(); halo.setValue(0); };
  }, [halo, reduceMotion, script.calm]);

  // ── Stage change: line slides out up, the next slides in from below; the icon pops ──
  const line = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (targetIdx === shownIdx) return;
    if (reduceMotion) { setShownIdx(targetIdx); return; }
    const out = Animated.timing(line, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true });
    // An Animated composite's stop() stops EVERY animation on the value — calling it after the
    // swap killed the fade-in halfway (text froze at ~43% opacity). Only stop an unfinished fade-out.
    let outDone = false;
    out.start(({ finished }) => {
      outDone = true;
      if (!finished) return;
      setShownIdx(targetIdx);
      pop.setValue(0.55);
      Animated.parallel([
        Animated.timing(line, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, damping: 9, stiffness: 220, mass: 0.6, useNativeDriver: true }),
      ]).start();
    });
    return () => { if (!outDone) out.stop(); };
  }, [targetIdx, shownIdx, reduceMotion, line, pop]);

  // ── Long turns: progress bar (asymptotic estimate) — ortak ProgressBar dolarak gelir ──
  const p = script.long ? estimatedProgress(script, elapsed) : 0;

  const core = coreStageCount(script);
  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, script.calm ? 1.5 : 1.7] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 1], outputRange: [script.calm ? 0.28 : 0.4, 0] });
  const lineY = line.interpolate({ inputRange: [0, 1], outputRange: [-7, 0] });
  const iconRotate = pop.interpolate({ inputRange: [0.55, 1], outputRange: ['-18deg', '0deg'] });
  const enterY = enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <Animated.View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      // A STABLE label: the rotating stage text must not re-announce on every flip.
      accessibilityLabel="Kochko yanıt hazırlıyor"
      style={{
        opacity: enter,
        transform: [{ translateY: enterY }],
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
        alignSelf: 'flex-start',
        maxWidth: '92%',
        ...style,
      }}
    >
      <CoachAvatar>
        {/* Nefes alan hale avatarın ARKASINDA (CoachAvatar çocukları plakanın altına çizer). */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', width: COACH_AVATAR, height: COACH_AVATAR, borderRadius: COACH_AVATAR / 2,
            backgroundColor: colors.primary, opacity: haloOpacity, transform: [{ scale: haloScale }],
          }}
        />
      </CoachAvatar>

      <View
        style={{
          flexShrink: 1,
          backgroundColor: colors.card,
          borderRadius: BUBBLE_RADIUS,
          borderBottomLeftRadius: BUBBLE_TAIL_RADIUS,
          borderWidth: BUBBLE_BORDER,
          borderColor: edge,
          paddingHorizontal: SPACING.md,
          paddingVertical: 10,
          gap: script.long ? 8 : 0,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <Animated.View
            style={{
              width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.primaryLight, transform: [{ scale: pop }, { rotate: iconRotate }],
            }}
          >
            <Ionicons name={stage.icon as keyof typeof Ionicons.glyphMap} size={15} color={colors.primary} />
          </Animated.View>

          <Animated.Text
            numberOfLines={2}
            style={{ ...TYPE.caption, color: colors.textSecondary, flexShrink: 1, opacity: line, transform: [{ translateY: lineY }] }}
          >
            {stage.text}
          </Animated.Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 2 }}>
            <Dot delay={0} color={colors.primary} cycleMs={script.calm ? 1500 : 900} />
            <Dot delay={script.calm ? 260 : 160} color={colors.primary} cycleMs={script.calm ? 1500 : 900} />
            <Dot delay={script.calm ? 520 : 320} color={colors.primary} cycleMs={script.calm ? 1500 : 900} />
          </View>
        </View>

        {script.long && (
          <View style={{ gap: 6 }}>
            <ProgressBar progress={p} color={colors.primary} height={8} duration={TICK_MS * 2} trackColor={edge} style={{ minWidth: 180 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {Array.from({ length: core }, (_, i) => {
                const done = i < Math.min(shownIdx, core);
                const current = i === Math.min(shownIdx, core - 1);
                return (
                  <View
                    key={i}
                    style={{
                      width: current ? 14 : 6, height: 6, borderRadius: 3,
                      backgroundColor: done || current ? colors.primary : edge,
                      opacity: done ? 0.55 : 1,
                    }}
                  />
                );
              })}
              <Text style={{ ...TYPE.caption, color: colors.textMuted, marginLeft: 4 }}>
                {Math.min(shownIdx + 1, core)}/{core}
              </Text>
            </View>
          </View>
        )}
        <SpeechTail side="left" face={colors.card} edge={edge} />
      </View>
    </Animated.View>
  );
}
