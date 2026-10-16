/** A retry of unchanged content reuses the token accepted by the database. */
export function saveAttempt(
  previous: { signature: string; id: string } | null,
  payload: unknown,
  newId: () => string = () => crypto.randomUUID(),
) {
  const signature = JSON.stringify(payload);
  return previous?.signature === signature ? previous : { signature, id: newId() };
}
