/** Never follow a provider redirect outside the approved push endpoint. */
export async function sendPushRequest(
  request: { endpoint: string; headers: HeadersInit; body: BodyInit },
  transport: typeof fetch = fetch,
): Promise<Response> {
  // Workers reject redirect: "error" before making any network request.
  // Manual mode returns redirects as non-success responses without following them.
  const send = () =>
    transport(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
  let response = await send();
  // Retry only an explicit temporary rejection, never an ambiguous timeout or redirect.
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 250));
    response = await send();
  }
  return response;
}
