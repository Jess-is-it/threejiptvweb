import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminDownloadSourcesIndexPage() {
  redirect('/admin/autodownload/sources/movies');
}

