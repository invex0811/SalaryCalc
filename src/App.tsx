import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  UploadCloud, 
  Trash2, 
  Plus,
  RefreshCw, 
  DollarSign, 
  Calendar, 
  Users, 
  Check, 
  AlertCircle, 
  FileSpreadsheet, 
  HelpCircle,
  TrendingUp,
  CreditCard,
  Settings,
  Save,
  Wallet
} from 'lucide-react';
import { parsePayStubExcel, type PayStubData } from './utils/excelParser';
import { calculateSalaries, type TeamMember } from './salaryCalculations';
import { buildAccruals, computeBalances, defaultPeriodForDate, formatPeriod, nextPartForPeriod } from './ledger.ts';
import { fetchNbuRate } from './nbu.ts';
import { useLedger } from './useLedger.ts';
import Ledger from './Ledger.tsx';

const MEMBERS_KEY = 'salarycalc:manual-members';
const PERMANENT_MEMBER_ID = 'manual:ruslan';

const permanentMember = (): TeamMember => ({
  id: PERMANENT_MEMBER_ID,
  name: 'Руслан',
  companyName: '',
  salaryType: 'remainder',
});

/** Участники без файла сохраняются в браузере; Руслан присутствует всегда. */
const loadManualMembers = (): TeamMember[] => {
  let saved: TeamMember[] = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(MEMBERS_KEY) ?? '[]');
    if (Array.isArray(raw)) {
      saved = raw
        .filter((m): m is TeamMember => !!m && typeof m.id === 'string' && typeof m.name === 'string')
        .map((m) => ({
          id: m.id,
          name: m.name,
          companyName: '',
          salaryType: m.salaryType === 'fixed' ? 'fixed' : 'remainder',
          fixedAmount: typeof m.fixedAmount === 'number' ? m.fixedAmount : undefined,
        }));
    }
  } catch {
    // повреждённые данные — начинаем с участника по умолчанию
  }
  return saved.some((m) => m.id === PERMANENT_MEMBER_ID) ? saved : [permanentMember(), ...saved];
};

const PARAMS_KEY = 'salarycalc:params';

interface SavedParams {
  totalContractAmount: number;
  ecbAmount: number;
  deductEcb: boolean;
  deductTaxes: boolean;
}

/** Последние введённые параметры расчёта — чтобы не вводить их заново. */
const loadParams = (): SavedParams => {
  const defaults: SavedParams = { totalContractAmount: 1124.5, ecbAmount: 1903, deductEcb: false, deductTaxes: true };
  try {
    const raw = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? 'null') as Partial<SavedParams> | null;
    if (!raw || typeof raw !== 'object') return defaults;
    return {
      totalContractAmount: Number.isFinite(raw.totalContractAmount) ? Number(raw.totalContractAmount) : defaults.totalContractAmount,
      ecbAmount: Number.isFinite(raw.ecbAmount) ? Number(raw.ecbAmount) : defaults.ecbAmount,
      deductEcb: typeof raw.deductEcb === 'boolean' ? raw.deductEcb : defaults.deductEcb,
      deductTaxes: typeof raw.deductTaxes === 'boolean' ? raw.deductTaxes : defaults.deductTaxes,
    };
  } catch {
    return defaults;
  }
};

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function App() {
  // --- States ---
  const [date, setDate] = useState<string>(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  
  const [exchangeRate, setExchangeRate] = useState<number>(44.7); // Default fallback
  const [isNbuLoading, setIsNbuLoading] = useState<boolean>(false);
  const [nbuStatus, setNbuStatus] = useState<{ success?: boolean; message?: string }>({});
  
  const [savedParams] = useState(loadParams);
  const [totalContractAmount, setTotalContractAmount] = useState<number>(savedParams.totalContractAmount);
  const [ecbAmount, setEcbAmount] = useState<number>(savedParams.ecbAmount);
  const [deductEcb, setDeductEcb] = useState<boolean>(savedParams.deductEcb);
  const [deductTaxes, setDeductTaxes] = useState<boolean>(savedParams.deductTaxes);

  useEffect(() => {
    try {
      localStorage.setItem(
        PARAMS_KEY,
        JSON.stringify({ totalContractAmount, ecbAmount, deductEcb, deductTaxes } satisfies SavedParams)
      );
    } catch {
      // хранилище недоступно — параметры останутся до перезагрузки страницы
    }
  }, [totalContractAmount, ecbAmount, deductEcb, deductTaxes]);

  // --- Учёт (начисления, переводы, остатки) ---
  const ledger = useLedger();
  const [periodOverride, setPeriodOverride] = useState<string>('');
  const [partOverride, setPartOverride] = useState<string>('');
  const [paymentNote, setPaymentNote] = useState<string>('');
  const [isSavingPayment, setIsSavingPayment] = useState<boolean>(false);
  const [paymentSaved, setPaymentSaved] = useState<string>('');
  
  const [payStubs, setPayStubs] = useState<PayStubData[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(loadManualMembers);

  useEffect(() => {
    try {
      localStorage.setItem(
        MEMBERS_KEY,
        JSON.stringify(teamMembers.filter((member) => !member.sourceFileName))
      );
    } catch {
      // хранилище недоступно — участники останутся до перезагрузки страницы
    }
  }, [teamMembers]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'calc' | 'ledger'>(() =>
    window.location.hash === '#ledger' ? 'ledger' : 'calc'
  );

  const switchTab = (tab: 'calc' | 'ledger') => {
    setActiveTab(tab);
    // Вкладка остаётся в адресе: при перезагрузке откроется та же.
    window.history.replaceState(null, '', tab === 'ledger' ? '#ledger' : window.location.pathname);
    window.scrollTo({ top: 0 });
  };
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Fetch NBU Exchange Rate ---
  const fetchExchangeRate = async (targetDate: string) => {
    setIsNbuLoading(true);
    setNbuStatus({});
    try {
      const rate = await fetchNbuRate(targetDate);
      setExchangeRate(rate);

      const parts = targetDate.split('-');
      const formattedDate = `${parts[2]}.${parts[1]}.${parts[0]}`;
      setNbuStatus({ success: true, message: `Курс USD на ${formattedDate} успешно загружен: ${rate} грн.` });
    } catch (error: unknown) {
      console.error('NBU API Fetch Error:', error);
      setNbuStatus({ success: false, message: `Не удалось загрузить курс: ${getErrorMessage(error)}` });
    } finally {
      setIsNbuLoading(false);
    }
  };

  // Fetch rate on date change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchExchangeRate(date);
  }, [date]);

  // --- File Upload / Drag & Drop Handlers ---
  const handleFiles = async (files: FileList) => {
    const newStubs: PayStubData[] = [];
    const errors: string[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!/\.xlsx?$/i.test(file.name)) {
        errors.push(`Файл ${file.name} не является Excel-файлом (.xls или .xlsx)`);
        continue;
      }
      try {
        const stubData = await parsePayStubExcel(file);
        newStubs.push(stubData);
      } catch (error: unknown) {
        errors.push(`Ошибка в файле ${file.name}: ${getErrorMessage(error)}`);
      }
    }

    if (errors.length > 0) {
      alert(errors.join('\n'));
    }

    if (newStubs.length > 0) {
      // Повторная загрузка файла заменяет его предыдущую версию.
      const filtered = payStubs.filter(
        (old) => !newStubs.some((stub) => stub.fileName.toUpperCase() === old.fileName.toUpperCase())
      );
      const updated = [...filtered, ...newStubs];

      setPayStubs(updated);

      // Один загруженный файл всегда соответствует одному участнику.
      setTeamMembers((prevMembers) => {
        const manualMembers = prevMembers.filter((member) => !member.sourceFileName);
        const fileMembers = updated.map((stub) => {
          const existing = prevMembers.find(
            (member) => member.sourceFileName?.toUpperCase() === stub.fileName.toUpperCase()
          );

          return {
            id: existing?.id ?? `paystub:${stub.fileName.toLowerCase()}`,
            name: stub.agentName,
            companyName: stub.companyName,
            sourceFileName: stub.fileName,
            salaryType: existing?.salaryType ?? 'paystub',
            fixedAmount: existing?.fixedAmount,
          } satisfies TeamMember;
        });

        return [...fileMembers, ...manualMembers];
      });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const removePayStub = (index: number) => {
    const fileName = payStubs[index]?.fileName;
    if (!fileName) return;

    setPayStubs((prev) => prev.filter((stub) => stub.fileName !== fileName));
    setTeamMembers((prev) => prev.filter((member) => member.sourceFileName !== fileName));
  };

  // --- Member CRUD Handlers ---
  const addMember = () => {
    setTeamMembers((prev) => [
      ...prev,
      {
        id: `manual:${Date.now()}`,
        name: 'Новый сотрудник',
        companyName: '',
        salaryType: 'remainder',
      },
    ]);
  };

  const updateMember = (id: string, fields: Partial<TeamMember>) => {
    setTeamMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...fields } : m)));
  };

  const deleteMember = (id: string) => {
    setTeamMembers((prev) => prev.filter((member) => member.id !== id));
  };

  // --- Salary Calculations ---
  const {
    memberCount,
    splitParticipantCount,
    payStubSplitRatio,
    ecbPerMember,
    remainderPool,
    remainderCount,
    remainderGrossPerMember,
    calculatedMembers,
  } = calculateSalaries({
    teamMembers,
    payStubs,
    totalContractAmount,
    exchangeRate,
    ecbAmount,
    deductEcb,
    deductTaxes,
  });

  // --- Сохранение выплаты в учёт ---
  const period = periodOverride || defaultPeriodForDate(date);
  const suggestedPart = nextPartForPeriod(ledger.data.accruals, period);
  const part = Math.max(1, parseInt(partOverride, 10) || suggestedPart);
  const totalBalanceUSD = useMemo(
    () => computeBalances(ledger.data, 0).reduce((sum, b) => sum + b.balanceUSD, 0),
    [ledger.data]
  );
  const memberNames = useMemo(() => teamMembers.map((member) => member.name), [teamMembers]);

  const savePayment = async () => {
    if (calculatedMembers.length === 0) {
      alert('Сначала загрузите PayStub или добавьте участников — сохранять пока нечего.');
      return;
    }
    if (!period) {
      alert('Укажите месяц, за который эта выплата.');
      return;
    }
    const names = calculatedMembers.map((member) => member.name.trim());
    if (names.some((name) => !name) || new Set(names).size !== names.length) {
      alert('У каждого участника должно быть своё непустое имя — по нему ведётся остаток.');
      return;
    }
    const existing = ledger.data.accruals.filter((a) => a.period === period && a.part === part);
    if (
      existing.length > 0 &&
      !confirm(`Часть ${part} за ${formatPeriod(period)} уже сохранена. Заменить её новым расчётом?`)
    ) return;

    setIsSavingPayment(true);
    setPaymentSaved('');
    const ok = await ledger.apply({
      deleteIds: existing.map((a) => a.id),
      accruals: buildAccruals({
        members: calculatedMembers,
        date,
        period,
        part,
        rate: exchangeRate,
        note: paymentNote.trim(),
      }),
    });
    setIsSavingPayment(false);
    if (ok) {
      setPaymentSaved(`Часть ${part} за ${formatPeriod(period)} сохранена в учёт`);
      setPartOverride('');
      setPaymentNote('');
    }
  };

  // Column Totals
  const totalPaystubRemaining = calculatedMembers.reduce((sum, m) => sum + m.payStubRemaining, 0);
  const totalGrossUSD = calculatedMembers.reduce((sum, m) => sum + m.grossUSD, 0);
  const totalTax5 = calculatedMembers.reduce((sum, m) => sum + m.tax5, 0);
  const totalTax1 = calculatedMembers.reduce((sum, m) => sum + m.tax1, 0);
  const totalNetUSD = calculatedMembers.reduce((sum, m) => sum + m.netUSD, 0);
  const totalEcbUAH = calculatedMembers.reduce((sum, m) => sum + m.ecbUAH, 0);
  const totalToCardUAH = calculatedMembers.reduce((sum, m) => sum + m.toCardUAH, 0);
  const toUSD = (uah: number) => (exchangeRate > 0 ? uah / exchangeRate : 0);
  const totalEcbUSD = toUSD(totalEcbUAH);
  const totalTaxesUSD = totalTax5 + totalTax1 + totalEcbUSD;

  // Formatting Helper
  const formatCurrency = (val: number, isUah = false) => {
    return val.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: isUah ? 2 : 4
    });
  };

  return (
    <div className="container animate-fade-in">
      {/* Header */}
      <header style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>Калькулятор Зарплаты</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Автоматический расчет долей, налогов и ЕСВ на основе paystub-файлов и курсов НБУ
          </p>
        </div>
        {activeTab === 'calc' && (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`btn btn-secondary`}
            >
              <Settings size={18} />
              {showConfig ? 'Скрыть настройки' : 'Настройка участников'}
            </button>
          </div>
        )}
      </header>

      {/* Вкладки */}
      <nav className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'calc'}
          className={`tab ${activeTab === 'calc' ? 'active' : ''}`}
          onClick={() => switchTab('calc')}
        >
          <CreditCard size={16} /> Расчёт
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'ledger'}
          className={`tab ${activeTab === 'ledger' ? 'active' : ''}`}
          onClick={() => switchTab('ledger')}
        >
          <Wallet size={16} /> Учёт и остатки
          {totalBalanceUSD !== 0 && <span className="tab-badge">${formatCurrency(totalBalanceUSD, true)}</span>}
        </button>
      </nav>

      {/* Main Grid */}
      <div className="dashboard-grid" style={{ display: activeTab === 'calc' ? undefined : 'none' }}>
        
        {/* Left Sidebar: Controls & Files */}
        <div className="settings-group">
          
          {/* NBU Exchange Rate Card */}
          <div className="glass-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <TrendingUp className="text-secondary" style={{ color: 'var(--secondary)' }} size={22} />
              <h2 style={{ fontSize: '1.2rem' }}>Курс Валют НБУ</h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label className="input-label">Дата расчета</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="date" 
                    value={date} 
                    onChange={(e) => setDate(e.target.value)}
                    className="input-control"
                    style={{ width: '100%', paddingRight: '2.5rem' }}
                  />
                  <Calendar size={16} style={{ position: 'absolute', right: '1rem', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Курс USD к UAH</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="number" 
                    step="0.0001"
                    value={exchangeRate} 
                    onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                    className="input-control"
                    style={{ width: '100%', paddingRight: '2.5rem', fontWeight: 600, color: 'var(--secondary)' }}
                  />
                  <span style={{ position: 'absolute', right: '1rem', fontWeight: 500, color: 'var(--text-muted)', fontSize: '0.85rem' }}>UAH</span>
                </div>
              </div>

              {/* Loader & Status Indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '24px' }}>
                {isNbuLoading ? (
                  <>
                    <div className="spinner" style={{ color: 'var(--secondary)' }}></div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Запрос к API НБУ...</span>
                  </>
                ) : nbuStatus.message ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.8rem', color: nbuStatus.success ? 'var(--success)' : 'var(--error)' }}>
                    {nbuStatus.success ? <Check size={14} style={{ marginTop: '2px', flexShrink: 0 }} /> : <AlertCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />}
                    <span>{nbuStatus.message}</span>
                  </div>
                ) : null}
              </div>
              
              <button 
                onClick={() => fetchExchangeRate(date)} 
                disabled={isNbuLoading}
                className="btn btn-secondary" 
                style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem' }}
              >
                <RefreshCw size={14} className={isNbuLoading ? 'spinner' : ''} />
                Обновить курс
              </button>
            </div>
          </div>

          {/* Calculations Global Settings Card */}
          <div className="glass-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Settings className="text-primary" style={{ color: 'var(--primary)' }} size={22} />
              <h2 style={{ fontSize: '1.2rem' }}>Параметры Расчета</h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label className="input-label">Общая сумма контракта ($)</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="number" 
                    step="0.01"
                    value={totalContractAmount} 
                    onChange={(e) => setTotalContractAmount(parseFloat(e.target.value) || 0)}
                    className="input-control"
                    style={{ width: '100%', paddingRight: '2.5rem' }}
                  />
                  <DollarSign size={16} style={{ position: 'absolute', right: '1rem', color: 'var(--text-muted)' }} />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">ЕСВ налог (грн)</label>
                <input 
                  type="number" 
                  step="1"
                  value={ecbAmount} 
                  disabled={!deductEcb}
                  onChange={(e) => setEcbAmount(parseFloat(e.target.value) || 0)}
                  className="input-control"
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', paddingLeft: '0.25rem' }}>
                  {exchangeRate > 0
                    ? `≈ $${(ecbAmount / exchangeRate).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} по курсу ${exchangeRate}`
                    : 'Укажите курс, чтобы увидеть сумму в долларах'}
                </p>
              </div>

              <div style={{ padding: '0.5rem 0' }}>
                <label className="switch-container">
                  <input
                    type="checkbox"
                    checked={deductTaxes}
                    onChange={(e) => setDeductTaxes(e.target.checked)}
                    className="switch-input"
                  />
                  <div className="switch-track">
                    <div className="switch-thumb"></div>
                  </div>
                  <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>Вычитать налоги (5% + 1%)</span>
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', paddingLeft: '0.25rem' }}>
                  {deductTaxes
                    ? 'Налоги будут вычтены из этой выплаты.'
                    : 'Эта выплата пойдёт на баланс без вычета налогов.'}
                </p>
              </div>

              <div style={{ padding: '0.5rem 0' }}>
                <label className="switch-container">
                  <input 
                    type="checkbox" 
                    checked={deductEcb} 
                    onChange={(e) => setDeductEcb(e.target.checked)}
                    className="switch-input"
                  />
                  <div className="switch-track">
                    <div className="switch-thumb"></div>
                  </div>
                  <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>Вычитать ЕСВ</span>
                </label>
                {deductEcb && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', paddingLeft: '0.25rem' }}>
                    Будет вычтено по <b>{formatCurrency(ecbPerMember, true)} грн.</b> на человека ({memberCount} уч.)
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Area: Tables and Files */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* File Upload Zone */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileSpreadsheet size={20} style={{ color: 'var(--secondary)' }} />
              Загрузка расчетных листов (PayStub)
            </h2>
            
            <div 
              className={`dropzone ${isDragging ? 'active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                multiple
                accept=".xls,.xlsx"
                style={{ display: 'none' }}
              />
              <div className="dropzone-icon">
                <UploadCloud size={28} />
              </div>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                  Перетащите сюда файлы PayStub (.xls, .xlsx) или нажмите для выбора
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Имя берется из ячейки COMPANY NAME, сумма из REMAINING PAY
                </p>
              </div>
            </div>

            {/* List of Uploaded Files */}
            {payStubs.length > 0 && (
              <div>
                <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Загруженные расчетные листы ({payStubs.length}):
                </p>
                <div className="file-list">
                  {payStubs.map((stub, idx) => (
                    <div key={idx} className="file-badge">
                      <FileSpreadsheet size={14} style={{ color: 'var(--secondary)' }} />
                      <span style={{ fontWeight: 500 }}>{stub.agentName}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        (${formatCurrency(stub.remainingPay)})
                      </span>
                      <Trash2 
                        size={14} 
                        className="file-badge-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePayStub(idx);
                        }} 
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Team configuration panel (toggled by settings button) */}
          {showConfig && (
            <div className="glass-card animate-fade-in" style={{ borderColor: 'rgba(0, 229, 255, 0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem' }}>
                <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Users size={20} style={{ color: 'var(--secondary)' }} />
                  Управление Участниками Расчета
                </h2>
                <button onClick={addMember} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                  <Plus size={14} /> Добавить без файла
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {teamMembers.map((member) => (
                  <div key={member.id} className="member-row">
                    <div className="input-group">
                      <label className="input-label" style={{ fontSize: '0.75rem' }}>Отображаемое имя</label>
                      <input 
                        type="text" 
                        value={member.name} 
                        onChange={(e) => updateMember(member.id, { name: e.target.value })}
                        className="input-control"
                        style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                      />
                    </div>

                    <div className="input-group">
                      <label className="input-label" style={{ fontSize: '0.75rem' }}>Тип расчета</label>
                      <select 
                        value={member.salaryType} 
                        onChange={(e) => updateMember(member.id, { salaryType: e.target.value as TeamMember['salaryType'] })}
                        className="input-control"
                        style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', background: '#0b0c16' }}
                      >
                        {member.sourceFileName && <option value="paystub">По файлу Paystub</option>}
                        <option value="remainder">Остаток от контракта</option>
                        <option value="fixed">Фиксированная (USD)</option>
                      </select>
                    </div>

                    {/* Conditional fields based on type */}
                    {member.salaryType === 'paystub' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem' }}>
                        <div className="input-group">
                          <label className="input-label" style={{ fontSize: '0.75rem' }}>COMPANY NAME в файле</label>
                          <input 
                            type="text" 
                            placeholder="Имя в Excel"
                            value={member.companyName} 
                            onChange={(e) => updateMember(member.id, { companyName: e.target.value })}
                            className="input-control"
                            style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                          />
                        </div>
                        <div className="input-group">
                          <label className="input-label" style={{ fontSize: '0.75rem' }}>Доля</label>
                          <input 
                            type="number" 
                            step="0.05"
                            value={payStubSplitRatio}
                            readOnly
                            className="input-control"
                            style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                          />
                        </div>
                      </div>
                    )}

                    {member.salaryType === 'fixed' && (
                      <div className="input-group">
                        <label className="input-label" style={{ fontSize: '0.75rem' }}>Фикс. сумма ($)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={member.fixedAmount || 0} 
                          onChange={(e) => updateMember(member.id, { fixedAmount: parseFloat(e.target.value) || 0 })}
                          className="input-control"
                          style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                        />
                      </div>
                    )}

                    {member.salaryType === 'remainder' && (
                      <div style={{ padding: '0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Получит остаток ${formatCurrency(remainderPool)} / {remainderCount} = ${formatCurrency(remainderGrossPerMember)}
                      </div>
                    )}

                    {!member.sourceFileName && member.id !== PERMANENT_MEMBER_ID && (
                      <button
                        onClick={() => deleteMember(member.id)}
                        className="btn btn-danger"
                        style={{ padding: '0.5rem', borderRadius: '8px', justifySelf: 'start' }}
                        title="Удалить сотрудника"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}

                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Calculation Table Card */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CreditCard size={20} style={{ color: 'var(--primary)' }} />
              Детализация расчета заработной платы
            </h2>
            
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>ФИО / Источник</th>
                    <th>Оригинал ($)</th>
                    <th>Сплит / Доля</th>
                    <th>Грязная ($)</th>
                    <th>Налог 5%</th>
                    <th>Воен. сб. 1%</th>
                    <th>Вычет ЕСВ</th>
                    <th>Чистыми ($)</th>
                    <th>На карту (грн)</th>
                  </tr>
                </thead>
                <tbody>
                  {calculatedMembers.map((member) => {
                    const isPaystub = member.salaryType === 'paystub';
                    const hasFile = isPaystub && member.payStubRemaining > 0;
                    
                    return (
                      <tr key={member.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{member.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {member.salaryType === 'paystub' && (
                              hasFile ? (
                                <span style={{ color: 'var(--success)' }}>✓ Файл загружен</span>
                              ) : (
                                <span style={{ color: 'var(--warning)' }}>✗ Требуется файл: {member.companyName || 'Не указан'}</span>
                              )
                            )}
                            {member.salaryType === 'remainder' && <span>Расчетный остаток</span>}
                            {member.salaryType === 'fixed' && <span>Фиксированная ставка</span>}
                          </div>
                        </td>
                        {/* Оригинал ($) */}
                        <td style={{ color: isPaystub && !hasFile ? 'var(--text-muted)' : 'inherit' }}>
                          {isPaystub ? `$${formatCurrency(member.payStubRemaining)}` : '-'}
                        </td>
                        {/* Сплит / Доля */}
                        <td>
                          {isPaystub ? (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                              х {member.splitRatio} (/{Math.round(1 / member.splitRatio)})
                            </span>
                          ) : '-'}
                        </td>
                        {/* Грязная ($) */}
                        <td style={{ fontWeight: 500 }}>
                          ${formatCurrency(member.grossUSD)}
                        </td>
                        {/* Налог 5% */}
                        <td>
                          <div>${formatCurrency(member.tax5)}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {formatCurrency(member.tax5 * exchangeRate, true)} ₴
                          </div>
                        </td>
                        {/* Воен. сб. 1% */}
                        <td>
                          <div>${formatCurrency(member.tax1)}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {formatCurrency(member.tax1 * exchangeRate, true)} ₴
                          </div>
                        </td>
                        {/* Вычет ЕСВ */}
                        <td style={{ color: member.ecbUAH > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                          <div>{member.ecbUAH > 0 ? `-$${formatCurrency(toUSD(member.ecbUAH))}` : '$0,00'}</div>
                          {member.ecbUAH > 0 && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              -{formatCurrency(member.ecbUAH, true)} ₴
                            </div>
                          )}
                        </td>
                        {/* Чистыми ($) — после налогов и ЕСВ */}
                        <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          ${formatCurrency(member.netUSD - toUSD(member.ecbUAH))}
                        </td>
                        {/* На карту (грн) */}
                        <td style={{ fontWeight: 700, color: 'var(--success)', fontSize: '1.05rem' }}>
                          {formatCurrency(member.toCardUAH, true)} ₴
                        </td>
                      </tr>
                    );
                  })}
                  
                  {/* Totals Row */}
                  <tr className="row-sum">
                    <td>Итого</td>
                    <td>
                      {totalPaystubRemaining > 0 ? `$${formatCurrency(totalPaystubRemaining)}` : ''}
                    </td>
                    <td></td>
                    <td>${formatCurrency(totalGrossUSD)}</td>
                    <td>
                      <div>${formatCurrency(totalTax5)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                        {formatCurrency(totalTax5 * exchangeRate, true)} ₴
                      </div>
                    </td>
                    <td>
                      <div>${formatCurrency(totalTax1)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                        {formatCurrency(totalTax1 * exchangeRate, true)} ₴
                      </div>
                    </td>
                    <td>
                      <div>{totalEcbUAH > 0 ? `-$${formatCurrency(totalEcbUSD)}` : '$0,00'}</div>
                      {totalEcbUAH > 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>
                          -{formatCurrency(totalEcbUAH, true)} ₴
                        </div>
                      )}
                    </td>
                    <td>${formatCurrency(totalNetUSD - totalEcbUSD)}</td>
                    <td style={{ fontSize: '1.15rem', textShadow: '0 0 10px rgba(0, 230, 118, 0.2)' }}>
                      {formatCurrency(totalToCardUAH, true)} ₴
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Общая сумма налогов всех участников */}
            <div className="tax-total">
              <div>
                <div style={{ fontWeight: 600 }}>Всего налогов за {memberCount} уч.</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  5%: ${formatCurrency(totalTax5, true)} · 1%: ${formatCurrency(totalTax1, true)} · ЕСВ:{' '}
                  {deductEcb ? `$${formatCurrency(totalEcbUSD, true)}` : 'не вычитается'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)' }}>
                  ${formatCurrency(totalTaxesUSD, true)}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {formatCurrency(totalTaxesUSD * exchangeRate, true)} ₴
                </div>
              </div>
            </div>

            {/* Calculations logic description helper */}
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)', marginTop: '1.5rem' }}>
              <HelpCircle size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                <b>Формулы расчета:</b><br />
                • Доля PayStub рассчитывается автоматически: <code>1 / количество участников без фиксированной зарплаты ({splitParticipantCount}) = {formatCurrency(payStubSplitRatio)}</code>.<br />
                • Грязная зп (Gross) для файлов = <code>REMAINING PAY * доля PayStub</code>.<br />
                • Участники без файла делят остаток: <code>(Общая сумма - зарплаты по файлам и фиксированные выплаты) / количество участников без файла</code>.<br />
                • Налог = <code>Gross * 5%</code>. Военный сбор = <code>Gross * 1%</code>{deductTaxes ? '' : ' (сейчас отключены галочкой «Вычитать налоги»)'}.<br />
                • Чистыми (USD) = <code>Gross - Налоги (6%) - ЕСВ в долларах</code>. На карту (грн) = <code>Чистыми (USD) * Курс НБУ ({exchangeRate})</code>.<br />
                • При включенном ЕСВ вычитается ровно <code>{formatCurrency(ecbAmount, true)} ₴ / {memberCount} чел. = {formatCurrency(ecbPerMember, true)} ₴</code> из выплаты каждого участника.
              </div>
            </div>
          </div>

          {/* Сохранение выплаты в учёт */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Save size={20} style={{ color: 'var(--success)' }} />
              Сохранить выплату в учёт
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Каждому участнику на баланс зачислится его сумма «Чистыми ($)»{deductEcb ? ' за вычетом ЕСВ' : ''}.
              Зарплата за месяц приходит двумя частями — сохраняйте каждую отдельно.
            </p>
            <div className="ledger-form">
              <div className="input-group">
                <label className="input-label">За какой месяц</label>
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriodOverride(e.target.value)}
                  className="input-control"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Часть выплаты</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={partOverride || String(suggestedPart)}
                  onChange={(e) => setPartOverride(e.target.value)}
                  className="input-control"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Комментарий</label>
                <input
                  type="text"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="input-control"
                  placeholder="необязательно"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button onClick={() => void savePayment()} disabled={isSavingPayment} className="btn btn-primary">
                <Save size={16} />
                {isSavingPayment ? 'Сохранение…' : `Сохранить: ${formatPeriod(period)}, часть ${part}`}
              </button>
              {paymentSaved && (
                <span style={{ color: 'var(--success)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Check size={14} /> {paymentSaved}
                  <button className="link-button" onClick={() => switchTab('ledger')}>Открыть учёт →</button>
                </span>
              )}
            </div>
          </div>

        </div>
      </div>

      <div style={{ display: activeTab === 'ledger' ? undefined : 'none' }}>
        <Ledger ledger={ledger} currentRate={exchangeRate} memberNames={memberNames} today={date} />
      </div>
    </div>
  );
}
