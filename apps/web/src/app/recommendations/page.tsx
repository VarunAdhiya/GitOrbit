import { Suspense } from 'react';
import { Shell } from '@/components/shell';
import { Discovery } from '@/components/discovery';
import { LoadingState } from '@/components/states';
export const metadata = { title: 'For you' };
export default function RecommendationsPage() {
  return (
    <Shell>
      <Suspense fallback={<LoadingState />}>
        <Discovery personalized />
      </Suspense>
    </Shell>
  );
}
