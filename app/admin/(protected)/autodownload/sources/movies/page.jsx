import AdminAutoDownloadSourcesPanel from '../../../../_components/AdminAutoDownloadSourcesPanel';

export const dynamic = 'force-dynamic';

export default function AdminMovieDownloadSourcesPage() {
  return (
    <div>
      <AdminAutoDownloadSourcesPanel type="movie" />
    </div>
  );
}

