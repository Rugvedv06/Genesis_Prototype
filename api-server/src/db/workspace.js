export async function getLocalWorkspaceId(queryable) {
  const { rows } = await queryable.query("SELECT id FROM workspaces WHERE slug = 'local' AND deleted_at IS NULL");
  if (rows.length !== 1) {
    const error = new Error('The local workspace is missing; apply database migrations before serving requests');
    error.code = 'local_workspace_unavailable';
    throw error;
  }
  return rows[0].id;
}
