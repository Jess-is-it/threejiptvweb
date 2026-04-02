'use client';

import AdminAutoDownloadDeletionLogPanel from '../../../../_components/AdminAutoDownloadDeletionLogPanel';

export const dynamic = 'force-dynamic';

export default function AdminAutoDeleteMoviesPage() {
  return <AdminAutoDownloadDeletionLogPanel type="movie" />;
}
