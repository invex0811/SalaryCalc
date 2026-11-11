// Учёт: что начислено каждому человеку, что уже переведено и сколько осталось.

export interface Accrual {
  id: string;
  /** Дата поступления платежа, YYYY-MM-DD */
  date: string;
  /** Месяц, за который зарплата, YYYY-MM */
  period: string;
  /** Номер части выплаты за этот месяц (1, 2, ...) */
  part: number;
  person: string;
  grossUSD: number;
  /** Удержанные налоги (5% + 1%) в USD; 0, если галочка налогов снята */
  taxUSD: number;
  /** Удержанный ЕСВ в грн */
  ecbUAH: number;
  /** Зачислено на баланс человека, USD */
  netUSD: number;
  /** Курс НБУ на дату платежа */
  rate: number;
  netUAH: number;
  note: string;
}

export interface Transfer {
  id: string;
  date: string;
  person: string;
  amountUSD: number;
  rate: number;
  amountUAH: number;
  note: string;
}

export interface LedgerData {
  accruals: Accrual[];
  transfers: Transfer[];
}

export interface LedgerChange {
  deleteIds?: string[];
  accruals?: Accrual[];
  transfers?: Transfer[];
}

export interface PersonBalance {
  person: string;
  accruedUSD: number;
  transferredUSD: number;
  transferredUAH: number;
  balanceUSD: number;
  balanceUAH: number;
}

export interface PeriodSummary {
  period: string;
  parts: number[];
  byPerson: Record<string, number>;
  totalUSD: number;
}

export interface PaymentMemberInput {
  name: string;
  grossUSD: number;
  tax5: number;
  tax1: number;
  netUSD: number;
  ecbUAH: number;
}

export const emptyLedger = (): LedgerData => ({ accruals: [], transfers: [] });

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const newId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Зарплата приходит в следующем месяце: для даты в ноябре период по умолчанию — октябрь. */
export const defaultPeriodForDate = (date: string): string => {
  const [year, month] = date.split('-').map(Number);
  if (!year || !month) return '';
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
};

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

export const formatPeriod = (period: string): string => {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return period;
  return `${MONTHS[month - 1]} ${year}`;
};

/** Следующий свободный номер части для месяца: 1, потом 2 и т.д. */
export const nextPartForPeriod = (accruals: Accrual[], period: string): number => {
  const parts = accruals.filter((a) => a.period === period).map((a) => a.part);
  return parts.length > 0 ? Math.max(...parts) + 1 : 1;
};

/** Превращает рассчитанную выплату в начисления — по одному на человека. */
export const buildAccruals = (params: {
  members: PaymentMemberInput[];
  date: string;
  period: string;
  part: number;
  rate: number;
  note?: string;
}): Accrual[] => {
  const { members, date, period, part, rate, note = '' } = params;
  return members
    .filter((member) => member.name.trim() !== '')
    .map((member) => {
      const ecbUSD = rate > 0 ? member.ecbUAH / rate : 0;
      const netUSD = round2(member.netUSD - ecbUSD);
      return {
        id: newId(),
        date,
        period,
        part,
        person: member.name.trim(),
        grossUSD: round2(member.grossUSD),
        taxUSD: round2(member.tax5 + member.tax1),
        ecbUAH: round2(member.ecbUAH),
        netUSD,
        rate,
        netUAH: round2(netUSD * rate),
        note,
      };
    });
};

export const applyChange = (data: LedgerData, change: LedgerChange): LedgerData => {
  const deleted = new Set(change.deleteIds ?? []);
  return {
    accruals: [...data.accruals.filter((a) => !deleted.has(a.id)), ...(change.accruals ?? [])],
    transfers: [...data.transfers.filter((t) => !deleted.has(t.id)), ...(change.transfers ?? [])],
  };
};

export const listPersons = (data: LedgerData, extra: string[] = []): string[] => {
  const names = new Set<string>();
  for (const a of data.accruals) names.add(a.person);
  for (const t of data.transfers) names.add(t.person);
  for (const name of extra) if (name.trim()) names.add(name.trim());
  return [...names];
};

/** Остатки по людям. currentRate — текущий курс для оценки остатка в гривне. */
export const computeBalances = (data: LedgerData, currentRate: number): PersonBalance[] =>
  listPersons(data).map((person) => {
    const accruedUSD = round2(
      data.accruals.filter((a) => a.person === person).reduce((sum, a) => sum + a.netUSD, 0)
    );
    const personTransfers = data.transfers.filter((t) => t.person === person);
    const transferredUSD = round2(personTransfers.reduce((sum, t) => sum + t.amountUSD, 0));
    const transferredUAH = round2(personTransfers.reduce((sum, t) => sum + t.amountUAH, 0));
    const balanceUSD = round2(accruedUSD - transferredUSD);
    return {
      person,
      accruedUSD,
      transferredUSD,
      transferredUAH,
      balanceUSD,
      balanceUAH: round2(balanceUSD * currentRate),
    };
  });

/** Начисления по месяцам (новые сверху). */
export const summarizePeriods = (data: LedgerData): PeriodSummary[] => {
  const map = new Map<string, PeriodSummary>();
  for (const a of data.accruals) {
    let summary = map.get(a.period);
    if (!summary) {
      summary = { period: a.period, parts: [], byPerson: {}, totalUSD: 0 };
      map.set(a.period, summary);
    }
    if (!summary.parts.includes(a.part)) summary.parts.push(a.part);
    summary.byPerson[a.person] = round2((summary.byPerson[a.person] ?? 0) + a.netUSD);
    summary.totalUSD = round2(summary.totalUSD + a.netUSD);
  }
  return [...map.values()]
    .map((s) => ({ ...s, parts: [...s.parts].sort((x, y) => x - y) }))
    .sort((x, y) => y.period.localeCompare(x.period));
};

const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const toText = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** Приводит данные из localStorage / Google Таблицы к строгому виду. */
export const normalizeLedger = (raw: unknown): LedgerData => {
  const source = (raw ?? {}) as { accruals?: unknown; transfers?: unknown };
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]) : [];

  return {
    accruals: rows(source.accruals)
      .filter((r) => toText(r.id) !== '')
      .map((r) => ({
        id: toText(r.id),
        date: toText(r.date),
        period: toText(r.period),
        part: toNumber(r.part) || 1,
        person: toText(r.person).trim(),
        grossUSD: toNumber(r.grossUSD),
        taxUSD: toNumber(r.taxUSD),
        ecbUAH: toNumber(r.ecbUAH),
        netUSD: toNumber(r.netUSD),
        rate: toNumber(r.rate),
        netUAH: toNumber(r.netUAH),
        note: toText(r.note),
      })),
    transfers: rows(source.transfers)
      .filter((r) => toText(r.id) !== '')
      .map((r) => ({
        id: toText(r.id),
        date: toText(r.date),
        person: toText(r.person).trim(),
        amountUSD: toNumber(r.amountUSD),
        rate: toNumber(r.rate),
        amountUAH: toNumber(r.amountUAH),
        note: toText(r.note),
      })),
  };
};
