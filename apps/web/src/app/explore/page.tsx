import { Suspense } from 'react';
import { Shell } from '@/components/shell';
import { Discovery } from '@/components/discovery';
import { LoadingState } from '@/components/states';
export const metadata = { title: 'Explore opportunities' };
export default function ExplorePage() {
  return (
    <Shell>
      <Suspense fallback={<LoadingState />}>
        <Discovery />
      </Suspense>
    </Shell>
  );
}
