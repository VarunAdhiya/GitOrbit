import { Shell } from '@/components/shell';
import { ProfileEditor } from '@/components/profile-editor';
export const metadata = { title: 'Your profile' };
export default function ResumePage() {
  return (
    <Shell>
      <ProfileEditor />
    </Shell>
  );
}
