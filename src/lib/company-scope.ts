/** Fail closed until the ERP has an explicit active-company selection feature. */
export function requireSingleCompanyId(rows: ReadonlyArray<{ id: string }> | null | undefined): string {
  if (!rows?.length || !rows[0]?.id) {
    throw new Error("No accessible company found. Contact the ERP administrator.");
  }
  if (rows.length !== 1) {
    throw new Error("Multiple companies are accessible. Select a company before creating records; company switching is not configured.");
  }
  return rows[0].id;
}
