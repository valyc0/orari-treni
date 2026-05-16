import { NextRequest, NextResponse } from 'next/server';
const VT = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const cod  = searchParams.get('cod')  ?? '';
  const num  = searchParams.get('num')  ?? '';
  const date = searchParams.get('date') ?? '';
  if (!cod || !num || !date) return NextResponse.json(null);
  try {
    const res = await fetch(`${VT}/andamentoTreno/${cod}/${num}/${date}`, { cache: 'no-store' });
    if (!res.ok || res.status === 204) return NextResponse.json(null);
    try { return NextResponse.json(await res.json()); } catch { return NextResponse.json(null); }
  } catch { return NextResponse.json(null); }
}
