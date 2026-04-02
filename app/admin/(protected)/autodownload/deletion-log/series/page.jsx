import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminSeriesDeletionLogPage() {
  redirect('/admin/autodownload/autodelete/series');
}
