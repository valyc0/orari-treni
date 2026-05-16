export interface Station { name: string; id: string; }

export interface Train {
  numeroTreno: number;
  codOrigine: string;
  dataPartenzaTreno: number;
  categoria: string;
  categoriaDescrizione: string;
  compNumeroTreno: string;
  destinazione?: string;
  origine?: string;
  orarioPartenza?: number;
  orarioArrivo?: number;
  orarioPartenzaZero?: number;
  orarioArrivoZero?: number;
  compOrarioPartenza?: string;
  compOrarioArrivo?: string;
  ritardo: number;
  nonPartito?: boolean;
  inStazione?: boolean;
  binarioEffettivoPartenzaDescrizione?: string;
  binarioProgrammatoPartenzaDescrizione?: string;
  binarioEffettivoArrivoDescrizione?: string;
  binarioProgrammatoArrivoDescrizione?: string;
}

export interface TrainStop {
  id: string;
  stazione: string;
  programmataArrivo?: number;
  programmataPartenza?: number;
  effettivaArrivo?: number;
  effettivaPartenza?: number;
  arrivo_teorico?: number;
  partenza_teorica?: number;
  programmata?: number;
  effettiva?: number;
  arrivoReale?: number;
  partenzaReale?: number;
  binarioEffettivoPartenzaDescrizione?: string;
  binarioProgrammatoPartenzaDescrizione?: string;
  binarioEffettivoArrivoDescrizione?: string;
  binarioProgrammatoArrivoDescrizione?: string;
  ritardo?: number;
  actualFermataType?: number;
}

export interface TrainDetails {
  numeroTreno: number;
  codOrigine: string;
  categoria: string;
  fermate: TrainStop[];
  ritardo: number;
  oraUltimoRilevamento?: number;
  stazioneUltimoRilevamento?: string;
}

export interface Favorite {
  id?: string;
  name?: string;
  type?: 'route';
  routeKey?: string;
  fromId?: string;
  fromName?: string;
  toId?: string;
  toName?: string;
}

export interface NotifThreshold { min: number; enabled: boolean; }

export type ActivePage = 'orari' | 'itinerario' | 'preferiti' | 'impostazioni';

export interface ConnectionSolution {
  type?: '2hop';
  key: string;
  leg1: { train: Train; depTime: number };
  transfer: { stationId: string; stationName: string; arrTime: number; depTime: number; waitMin: number; binEff: string|null; binProg: string|null; };
  leg2: { train: Train; arrTime: number };
  totalMin: number;
}

export interface Connection2Solution {
  type: '2hop';
  key: string;
  leg1: { train: Train; depTime: number };
  transfer1: { stationId: string; stationName: string; arrTime: number; depTime: number; waitMin: number; arrObj?: Train; };
  leg2: { train: Train };
  transfer2: { stationId: string; stationName: string; arrTime: number; depTime: number; waitMin: number; arrObj?: Train; };
  leg3: { train: Train; arrTime: number };
  totalMin: number;
}

export interface DirectMatch { dep: Train; arr: Train; }

export interface TrattaCardData {
  trainLabel: string;
  trainNum: string;
  trainDate: string;
  codOrigine: string;
  routeFrom: string;
  routeTo: string;
  depTs: number;
  train2Num?: string;
  train2Date?: string;
  codOrigine2?: string;
  transferStation?: string;
  train3Num?: string;
  train3Date?: string;
  codOrigine3?: string;
  transfer2Station?: string;
}
