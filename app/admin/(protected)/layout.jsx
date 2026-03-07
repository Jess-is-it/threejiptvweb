import { redirect } from 'next/navigation';

import { requireAdmin } from '../../../lib/server/adminAuth';
import AdminShell from '../_components/AdminShell';

export const dynamic = 'force-dynamic';

export default async function AdminProtectedLayout({ children }) {
  const admin = await requireAdmin();
  if (!admin) redirect('/admin/login');
  return <AdminShell admin={admin}>{children}</AdminShell>;
}

