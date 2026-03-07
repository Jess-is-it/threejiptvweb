import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminMoviesSelectionLogPage() {
  redirect('/admin/autodownload/movies');
}
