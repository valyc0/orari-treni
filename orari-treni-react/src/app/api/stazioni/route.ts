import { NextRequest, NextResponse } from 'next/server';
const VT = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (!q) return NextResponse.json([]);
  try {
    const res = await fetch(`${VT}/autocompletaStazione/${encodeURIComponent(q)}`, { next: { revalidate: 3600 } });
    if (!res.ok) return NextResponse.json([]);
    const text = await res.text();
    if (!text.trim()) return NextResponse.json([]);
    const stations = text.trim().split('\n')
      .map(line => { const p = line.split('|'); return { name: (p[0]??'').trim(), id: (p[1]??'').trim() }; })
      .filter(s => s.id && s.name);
    return NextResponse.json(stations);
  } catch { return NextResponse.json([]); }
}
