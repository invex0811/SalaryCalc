import { useCallback, useEffect, useRef, useState } from 'react';
import { applyChange, type LedgerChange, type LedgerData } from './ledger.ts';
import {
  applyRemoteChange,
  fetchRemoteLedger,
  loadLocalLedger,
  loadSheetsConfig,
  saveLocalLedger,
  saveSheetsConfig,
  type SheetsConfig,
} from './storage.ts';

export interface SyncStatus {
  state: 'local' | 'loading' | 'synced' | 'error';
  message: string;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const timeNow = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const useLedger = () => {
  const [data, setData] = useState<LedgerData>(loadLocalLedger);
  const [config, setConfig] = useState<SheetsConfig | null>(loadSheetsConfig);
  const [status, setStatus] = useState<SyncStatus>(() =>
    loadSheetsConfig()
      ? { state: 'loading', message: 'Загрузка из Google Таблицы…' }
      : { state: 'local', message: 'Данные хранятся только в этом браузере' }
  );
  const dataRef = useRef(data);

  const commit = useCallback((next: LedgerData) => {
    dataRef.current = next;
    setData(next);
    saveLocalLedger(next);
  }, []);

  /** Подтянуть данные из таблицы. Если таблица пустая, а локально что-то есть — выгрузить туда. */
  const pull = useCallback(async (target: SheetsConfig): Promise<boolean> => {
    setStatus({ state: 'loading', message: 'Загрузка из Google Таблицы…' });
    try {
      let remote = await fetchRemoteLedger(target);
      const local = dataRef.current;
      const remoteEmpty = remote.accruals.length === 0 && remote.transfers.length === 0;
      const localHasData = local.accruals.length > 0 || local.transfers.length > 0;
      if (remoteEmpty && localHasData) {
        remote = await applyRemoteChange(target, { accruals: local.accruals, transfers: local.transfers });
      }
      commit(remote);
      setStatus({ state: 'synced', message: `Синхронизировано с Google Таблицей в ${timeNow()}` });
      return true;
    } catch (error) {
      setStatus({ state: 'error', message: errorText(error) });
      return false;
    }
  }, [commit]);

  useEffect(() => {
    const initial = loadSheetsConfig();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial) void pull(initial);
  }, [pull]);

  const apply = useCallback(async (change: LedgerChange): Promise<boolean> => {
    if (!config) {
      commit(applyChange(dataRef.current, change));
      return true;
    }
    setStatus({ state: 'loading', message: 'Сохранение в Google Таблицу…' });
    try {
      commit(await applyRemoteChange(config, change));
      setStatus({ state: 'synced', message: `Сохранено в Google Таблицу в ${timeNow()}` });
      return true;
    } catch (error) {
      setStatus({ state: 'error', message: `Не сохранено: ${errorText(error)}` });
      return false;
    }
  }, [config, commit]);

  const connect = useCallback(async (next: SheetsConfig): Promise<boolean> => {
    const ok = await pull(next);
    if (ok) {
      saveSheetsConfig(next);
      setConfig(next);
    }
    return ok;
  }, [pull]);

  const disconnect = useCallback(() => {
    saveSheetsConfig(null);
    setConfig(null);
    setStatus({ state: 'local', message: 'Данные хранятся только в этом браузере' });
  }, []);

  const reload = useCallback(() => (config ? pull(config) : Promise.resolve(true)), [config, pull]);

  return { data, config, status, apply, connect, disconnect, reload };
};
