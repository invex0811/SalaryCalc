import {
  emptyLedger,
  normalizeLedger,
  type LedgerChange,
  type LedgerData,
} from './ledger.ts';

export interface SheetsConfig {
  /** URL веб-приложения Apps Script (…/exec) */
  url: string;
  /** Секретный ключ, заданный в скрипте */
  key: string;
}

const DATA_KEY = 'salarycalc:ledger';
const CONFIG_KEY = 'salarycalc:sheets';

export const loadLocalLedger = (): LedgerData => {
  try {
    return normalizeLedger(JSON.parse(localStorage.getItem(DATA_KEY) ?? 'null'));
  } catch {
    return emptyLedger();
  }
};

export const saveLocalLedger = (data: LedgerData): void => {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  } catch {
    // Хранилище браузера недоступно — данные останутся только в памяти / в таблице.
  }
};

export const loadSheetsConfig = (): SheetsConfig | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as Partial<SheetsConfig> | null;
    return raw?.url && raw.key ? { url: raw.url, key: raw.key } : null;
  } catch {
    return null;
  }
};

export const saveSheetsConfig = (config: SheetsConfig | null): void => {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    // см. выше
  }
};

const callSheets = async (
  config: SheetsConfig,
  payload: Record<string, unknown>
): Promise<LedgerData> => {
  let response: Response;
  try {
    // text/plain — чтобы браузер не слал preflight, который Apps Script не поддерживает.
    response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, key: config.key }),
      redirect: 'follow',
    });
  } catch {
    throw new Error('Нет связи с Google Таблицей. Проверьте URL и что доступ к скрипту открыт «Всем».');
  }
  if (!response.ok) throw new Error(`Google Таблица ответила ошибкой ${response.status}`);

  let body: { ok?: boolean; error?: string; data?: unknown };
  try {
    body = await response.json();
  } catch {
    throw new Error('Неожиданный ответ. Проверьте, что URL заканчивается на /exec и доступ открыт «Всем».');
  }
  if (!body.ok) throw new Error(body.error || 'Скрипт вернул ошибку');
  return normalizeLedger(body.data);
};

export const fetchRemoteLedger = (config: SheetsConfig): Promise<LedgerData> =>
  callSheets(config, { action: 'list' });

export const applyRemoteChange = (config: SheetsConfig, change: LedgerChange): Promise<LedgerData> =>
  callSheets(config, { action: 'apply', ...change });
