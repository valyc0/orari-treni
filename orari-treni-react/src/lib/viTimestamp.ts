const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function viTimestamp(date: Date = new Date()): string {
  const off    = date.getTimezoneOffset();
  const sign   = off <= 0 ? '+' : '-';
  const abs    = Math.abs(off);
  const offStr = String(Math.floor(abs/60)).padStart(2,'0') + String(abs%60).padStart(2,'0');
  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${String(date.getDate()).padStart(2,'0')} ` +
         `${date.getFullYear()} ${String(date.getHours()).padStart(2,'0')}:` +
         `${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')} GMT${sign}${offStr}`;
}

export function buildTimeWindows(date0: Date): string[] {
  return [0, 60, 120].map(d => viTimestamp(new Date(date0.getTime() + d*60000)));
}

export function buildArrivalWindows(date0: Date): string[] {
  return [0, 60, 120, 180, 240, 300].map(d => viTimestamp(new Date(date0.getTime() + d*60000)));
}
