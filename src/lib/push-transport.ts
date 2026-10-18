/** Never follow a provider redirect outside the approved push endpoint. */
export async function sendPushRequest(
  request: { endpoint: string; headers: HeadersInit; body: BodyInit },
  transport: typeof fetch = fetch,
): Promise<Response> {
  // Workers reject redirect: "error" before making any network request.
  // Manual mode returns redirects as non-success responses without following them.
  return transport(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
}