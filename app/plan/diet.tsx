/**
 * Diet plan route — thin expo-router wrapper.
 * All screen logic lives in src/screens/PlanManagerScreen.tsx (shared with
 * app/plan/workout.tsx), parameterized by planType.
 */
import { PlanManagerScreen } from '@/screens/PlanManagerScreen';

export default function DietPlanScreen() {
  return <PlanManagerScreen planType="diet" />;
}
