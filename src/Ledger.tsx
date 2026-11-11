import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  Cloud,
  CloudOff,
  History,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  computeBalances,
  formatPeriod,
  listPersons,
  newId,
  round2,
  summarizePeriods,
} from './ledger.ts';
import { fetchNbuRate } from './nbu.ts';
import type { useLedger } from './useLedger.ts';

interface LedgerProps {
  ledger: ReturnType<typeof useLedger>;
  /** Текущий курс — для оценки остатка в гривне */
  currentRate: number;
  /** Имена участников из текущего расчёта (чтобы можно было выбрать до первого начисления) */
  memberNames: string[];
  today: string;
}

const money = (value: number) =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (date: string) => {
  const [y, m, d] = date.split('-');
  return y && m && d ? `${d}.${m}.${y}` : date;
};

export default function Ledger({ ledger, currentRate, memberNames, today }: LedgerProps) {
  const { data, config, status, apply, connect, disconnect, reload } = ledger;

  const balances = useMemo(() => computeBalances(data, currentRate), [data, currentRate]);
  const periods = useMemo(() => summarizePeriods(data), [data]);
  const persons = useMemo(() => listPersons(data, memberNames), [data, memberNames]);
  const ledgerPersons = useMemo(() => listPersons(data), [data]);

  // --- Форма перевода ---
  const [person, setPerson] = useState('');
  const [date, setDate] = useState(today);
  const [usd, setUsd] = useState('');
  const [rate, setRate] = useState(String(currentRate));
  const [uah, setUah] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const selectedPerson = persons.includes(person) ? person : persons[0] ?? '';
  const selectedBalance = balances.find((b) => b.person === selectedPerson)?.balanceUSD ?? 0;

  useEffect(() => {
    let cancelled = false;
    fetchNbuRate(date)
      .then((value) => {
        if (cancelled) return;
        setRate(String(value));
        setUah((prevUah) => {
          const usdValue = parseFloat(usd);
          return usdValue > 0 ? String(round2(usdValue * value)) : prevUah;
        });
      })
      .catch(() => { /* курс можно ввести вручную */ });
    return () => { cancelled = true; };
    // Курс подтягиваем только при смене даты.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const onUsdChange = (value: string) => {
    setUsd(value);
    const usdValue = parseFloat(value);
    const rateValue = parseFloat(rate);
    setUah(usdValue > 0 && rateValue > 0 ? String(round2(usdValue * rateValue)) : '');
  };

  const onRateChange = (value: string) => {
    setRate(value);
    const usdValue = parseFloat(usd);
    const rateValue = parseFloat(value);
    if (usdValue > 0 && rateValue > 0) setUah(String(round2(usdValue * rateValue)));
  };

  const onUahChange = (value: string) => {
    setUah(value);
    const uahValue = parseFloat(value);
    const rateValue = parseFloat(rate);
    setUsd(uahValue > 0 && rateValue > 0 ? String(round2(uahValue / rateValue)) : '');
  };

  const submitTransfer = async () => {
    const amountUSD = round2(parseFloat(usd) || 0);
    const rateValue = parseFloat(rate) || 0;
    const amountUAH = round2(parseFloat(uah) || amountUSD * rateValue);
    if (!selectedPerson) return setFormError('Выберите, чьи деньги переводятся');
    if (!date) return setFormError('Укажите дату перевода');
    if (amountUSD <= 0) return setFormError('Укажите сумму перевода');
    if (
      amountUSD > selectedBalance + 0.005 &&
      !confirm(`Перевод $${money(amountUSD)} больше остатка ${selectedPerson} ($${money(selectedBalance)}). Всё равно записать?`)
    ) return;

    setFormError('');
    setIsSaving(true);
    const ok = await apply({
      transfers: [{ id: newId(), date, person: selectedPerson, amountUSD, rate: rateValue, amountUAH, note: note.trim() }],
    });
    setIsSaving(false);
    if (ok) {
      setUsd('');
      setUah('');
      setNote('');
    }
  };

  // --- История ---
  const history = useMemo(() => {
    const rows = [
      ...data.accruals.map((a) => ({
        id: a.id,
        date: a.date,
        kind: 'accrual' as const,
        person: a.person,
        title: `Начисление за ${formatPeriod(a.period)}, часть ${a.part}`,
        usd: a.netUSD,
        rate: a.rate,
        uah: a.netUAH,
        note: [a.taxUSD > 0 ? `налоги $${money(a.taxUSD)}` : 'без налогов', a.ecbUAH > 0 ? `ЕСВ ${money(a.ecbUAH)} ₴` : '', a.note]
          .filter(Boolean).join(' · '),
      })),
      ...data.transfers.map((t) => ({
        id: t.id,
        date: t.date,
        kind: 'transfer' as const,
        person: t.person,
        title: 'Перевод',
        usd: -t.amountUSD,
        rate: t.rate,
        uah: -t.amountUAH,
        note: t.note,
      })),
    ];
    return rows.sort((x, y) => y.date.localeCompare(x.date) || y.id.localeCompare(x.id));
  }, [data]);

  const removeEntry = async (id: string, description: string) => {
    if (confirm(`Удалить запись «${description}»? Остаток будет пересчитан.`)) {
      await apply({ deleteIds: [id] });
    }
  };

  // --- Подключение Google Таблицы ---
  const [sheetUrl, setSheetUrl] = useState(config?.url ?? '');
  const [sheetKey, setSheetKey] = useState(config?.key ?? '');
  const [showSheets, setShowSheets] = useState(false);

  const submitConnect = async () => {
    const url = sheetUrl.trim();
    const key = sheetKey.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      alert('URL должен начинаться с https://script.google.com/ и заканчиваться на /exec');
      return;
    }
    if (!key) {
      alert('Введите секретный ключ, который вы указали в скрипте');
      return;
    }
    if (await connect({ url, key })) setShowSheets(false);
  };

  const statusColor =
    status.state === 'error' ? 'var(--error)' : status.state === 'synced' ? 'var(--success)' : 'var(--text-secondary)';
  const totalBalance = round2(balances.reduce((sum, b) => sum + b.balanceUSD, 0));

  return (
    <section className="ledger">
      <div className="ledger-header">
        <div>
          <h2 style={{ fontSize: '1.5rem' }}>Учёт и остатки</h2>
          <div className="ledger-status" style={{ color: statusColor }}>
            {status.state === 'loading' ? <div className="spinner" /> :
              status.state === 'error' ? <AlertCircle size={14} /> :
              status.state === 'synced' ? <Check size={14} /> : <CloudOff size={14} />}
            <span>{status.message}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {config && (
            <button className="btn btn-secondary" onClick={() => void reload()} disabled={status.state === 'loading'}>
              <RefreshCw size={16} /> Обновить
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowSheets(!showSheets)}>
            <Cloud size={16} /> {config ? 'Google Таблица подключена' : 'Подключить Google Таблицу'}
          </button>
        </div>
      </div>

      {showSheets && (
        <div className="glass-card animate-fade-in" style={{ borderColor: 'rgba(0, 229, 255, 0.25)' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Google Таблица</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
            Создайте таблицу, откройте «Расширения → Apps Script», вставьте скрипт из файла{' '}
            <code>google-apps-script/Code.gs</code>, задайте в нём свой ключ и опубликуйте как веб-приложение
            (запуск от вашего имени, доступ «Все»). Подробная инструкция — в README. URL и ключ хранятся
            только в этом браузере.
          </p>
          <div className="ledger-form">
            <div className="input-group">
              <label className="input-label">URL веб-приложения (…/exec)</label>
              <input className="input-control" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/…/exec" />
            </div>
            <div className="input-group">
              <label className="input-label">Секретный ключ</label>
              <input className="input-control" type="password" value={sheetKey} autoComplete="off"
                onChange={(e) => setSheetKey(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'end' }}>
              <button className="btn btn-primary" onClick={() => void submitConnect()} disabled={status.state === 'loading'}>
                {config ? 'Переподключить' : 'Подключить'}
              </button>
              {config && (
                <button className="btn btn-danger" onClick={disconnect}>Отключить</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Остатки */}
      {balances.length === 0 ? (
        <div className="glass-card" style={{ color: 'var(--text-secondary)' }}>
          Пока нет начислений. Рассчитайте выплату выше и нажмите «Сохранить выплату в учёт» —
          здесь появятся остатки по каждому человеку.
        </div>
      ) : (
        <div className="balance-grid">
          {balances.map((b) => (
            <div key={b.person} className="glass-card balance-card">
              <div className="balance-name"><Wallet size={16} /> {b.person}</div>
              <div className="balance-amount" style={{ color: b.balanceUSD < 0 ? 'var(--error)' : 'var(--success)' }}>
                ${money(b.balanceUSD)}
              </div>
              <div className="balance-sub">≈ {money(b.balanceUAH)} ₴ по курсу {currentRate}</div>
              <div className="balance-rows">
                <div><span>Начислено</span><b>${money(b.accruedUSD)}</b></div>
                <div><span>Переведено</span><b>${money(b.transferredUSD)} · {money(b.transferredUAH)} ₴</b></div>
              </div>
            </div>
          ))}
          {balances.length > 1 && (
            <div className="glass-card balance-card">
              <div className="balance-name">Всего осталось</div>
              <div className="balance-amount">${money(totalBalance)}</div>
              <div className="balance-sub">≈ {money(round2(totalBalance * currentRate))} ₴ по курсу {currentRate}</div>
            </div>
          )}
        </div>
      )}

      {/* Новый перевод */}
      <div className="glass-card">
        <h3 className="ledger-title"><ArrowRightLeft size={18} style={{ color: 'var(--secondary)' }} /> Записать перевод</h3>
        {persons.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Сначала сохраните первую выплату.</p>
        ) : (
          <>
            <div className="ledger-form">
              <div className="input-group">
                <label className="input-label">Чьи деньги</label>
                <select className="input-control" style={{ background: '#0b0c16' }} value={selectedPerson}
                  onChange={(e) => setPerson(e.target.value)}>
                  {persons.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Дата перевода</label>
                <input className="input-control" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">Сумма ($)</label>
                <input className="input-control" type="number" step="0.01" min="0" value={usd}
                  onChange={(e) => onUsdChange(e.target.value)} placeholder="0.00" />
              </div>
              <div className="input-group">
                <label className="input-label">Курс</label>
                <input className="input-control" type="number" step="0.0001" min="0" value={rate}
                  onChange={(e) => onRateChange(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">Сумма (грн)</label>
                <input className="input-control" type="number" step="0.01" min="0" value={uah}
                  onChange={(e) => onUahChange(e.target.value)} placeholder="0.00" />
              </div>
              <div className="input-group">
                <label className="input-label">Комментарий</label>
                <input className="input-control" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="например, на карту" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => void submitTransfer()} disabled={isSaving}>
                {isSaving ? 'Сохранение…' : 'Записать перевод'}
              </button>
              <button className="btn btn-secondary" disabled={selectedBalance <= 0}
                onClick={() => onUsdChange(String(selectedBalance))}>
                Весь остаток (${money(Math.max(selectedBalance, 0))})
              </button>
              {formError && <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{formError}</span>}
            </div>
          </>
        )}
      </div>

      {/* По месяцам */}
      {periods.length > 0 && (
        <div className="glass-card">
          <h3 className="ledger-title">Начислено по месяцам</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>За месяц</th>
                  <th>Части</th>
                  {ledgerPersons.map((name) => <th key={name}>{name}</th>)}
                  <th>Всего</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.period}>
                    <td style={{ fontWeight: 600 }}>{formatPeriod(p.period)}</td>
                    <td>
                      {p.parts.join(' + ')}
                      {p.parts.length < 2 && <span style={{ color: 'var(--warning)', fontSize: '0.75rem' }}> · ждём вторую часть</span>}
                    </td>
                    {ledgerPersons.map((name) => <td key={name}>${money(p.byPerson[name] ?? 0)}</td>)}
                    <td style={{ fontWeight: 600 }}>${money(p.totalUSD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* История */}
      {history.length > 0 && (
        <div className="glass-card">
          <h3 className="ledger-title"><History size={18} style={{ color: 'var(--primary)' }} /> История операций</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Операция</th>
                  <th>Участник</th>
                  <th>Сумма ($)</th>
                  <th>Курс</th>
                  <th>Сумма (грн)</th>
                  <th>Детали</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.date)}</td>
                    <td>{row.title}</td>
                    <td style={{ fontWeight: 600 }}>{row.person}</td>
                    <td style={{ fontWeight: 600, color: row.usd < 0 ? 'var(--accent)' : 'var(--success)' }}>
                      {row.usd < 0 ? '−' : '+'}${money(Math.abs(row.usd))}
                    </td>
                    <td>{row.rate || '—'}</td>
                    <td>{row.usd < 0 ? '−' : '+'}{money(Math.abs(row.uah))} ₴</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.note}</td>
                    <td>
                      <button className="btn btn-danger" style={{ padding: '0.35rem' }} title="Удалить запись"
                        onClick={() => void removeEntry(row.id, `${row.title}, ${row.person}, $${money(Math.abs(row.usd))}`)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
