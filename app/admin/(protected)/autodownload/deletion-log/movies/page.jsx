import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminMoviesDeletionLogPage() {
  redirect('/admin/autodownload/autodelete/movies');
}
