'use client';

import AdminAutoDownloadDownloadsPanel from '../../../_components/AdminAutoDownloadDownloadsPanel';

export const dynamic = 'force-dynamic';

export default function AdminSeriesDownloadsPage() {
  return (
    <div>
      <AdminAutoDownloadDownloadsPanel type="series" />
    </div>
  );
}
