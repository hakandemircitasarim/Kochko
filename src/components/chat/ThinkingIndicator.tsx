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
 */
import { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, Text, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';
import { Dot } from '@/components/chat/TypingIndicator';
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
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

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

  // ── Long turns: progress bar (asymptotic estimate) + a shimmer sweeping across it ──
  const progress = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const [barWidth, setBarWidth] = useState(0);
  const p = script.long ? estimatedProgress(script, elapsed) : 0;
  useEffect(() => {
    if (!script.long) return;
    if (reduceMotion) { progress.setValue(p); return; }
    Animated.timing(progress, { toValue: p, duration: TICK_MS * 2, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [p, script.long, reduceMotion, progress]);
  useEffect(() => {
    if (!script.long || reduceMotion) return;
    const loop = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => { loop.stop(); shimmer.setValue(0); };
  }, [shimmer, script.long, reduceMotion]);

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
        backgroundColor: colors.card,
        borderRadius: 16,
        borderBottomLeftRadius: 4,
        paddingHorizontal: SPACING.md,
        paddingVertical: 10,
        alignSelf: 'flex-start',
        maxWidth: '88%',
        borderWidth: 0.5,
        borderColor: colors.border,
        gap: script.long ? 8 : 0,
        ...style,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', width: 26, height: 26, borderRadius: 13,
              backgroundColor: colors.primary, opacity: haloOpacity, transform: [{ scale: haloScale }],
            }}
          />
          <KochkoMascot size={24} />
        </View>

        <Animated.View
          style={{
            width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.primaryLight, transform: [{ scale: pop }, { rotate: iconRotate }],
          }}
        >
          <Ionicons name={stage.icon as keyof typeof Ionicons.glyphMap} size={14} color={colors.primary} />
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
          <View
            onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
            style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden', minWidth: 180 }}
          >
            <Animated.View
              style={{
                height: 4, borderRadius: 2, backgroundColor: colors.primary, overflow: 'hidden',
                width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }}
            >
              {!reduceMotion && barWidth > 0 && (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute', top: 0, bottom: 0, width: 36, backgroundColor: '#FFFFFF', opacity: 0.35,
                    transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-36, barWidth] }) }],
                  }}
                />
              )}
            </Animated.View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {Array.from({ length: core }, (_, i) => {
              const done = i < Math.min(shownIdx, core);
              const current = i === Math.min(shownIdx, core - 1);
              return (
                <View
                  key={i}
                  style={{
                    width: current ? 14 : 6, height: 6, borderRadius: 3,
                    backgroundColor: done || current ? colors.primary : colors.border,
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
    </Animated.View>
  );
}
