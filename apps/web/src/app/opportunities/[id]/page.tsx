import { Shell } from '@/components/shell';
import { OpportunityDetail } from '@/components/opportunity-detail';
export const metadata = { title: 'Opportunity details' };
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Shell>
      <OpportunityDetail id={id} />
    </Shell>
  );
}
