export function GET() {
  return Response.json(
    { status: 'ok', service: 'sicklecare-web' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
