import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminAutoDeleteIndexPage() {
  redirect('/admin/autodownload/autodelete/settings');
}
