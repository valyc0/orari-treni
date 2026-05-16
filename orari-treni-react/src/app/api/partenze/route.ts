import { NextRequest, NextResponse } from 'next/server';
const VT = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const ts = req.nextUrl.searchParams.get('ts') ?? '';
  if (!id || !ts) return NextResponse.json([]);
  try {
    const res = await fetch(`${VT}/partenze/${id}/${encodeURIComponent(ts)}`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json([]);
    return NextResponse.json(await res.json());
  } catch { return NextResponse.json([]); }
}
