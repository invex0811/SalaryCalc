import React, { useState, useEffect, useRef } from 'react';
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
  Settings
} from 'lucide-react';
import { parsePayStubExcel, type PayStubData } from './utils/excelParser';

interface TeamMember {
  id: string;
  name: string;
  companyName: string;
  salaryType: 'paystub' | 'remainder' | 'fixed';
  fixedAmount?: number;
  splitRatio: number;
}

const DEFAULT_MEMBERS: TeamMember[] = [
  {
    id: '1',
    name: 'Игорь Кєся',
    companyName: 'КЄСЯ ІГОР МИКОЛАЙОВИЧ',
    salaryType: 'paystub',
    splitRatio: 0.5,
  },
  {
    id: '2',
    name: 'Эдуард Качалов',
    companyName: 'КАЧАЛОВ ЕДУАРД МАКСИМОВИЧ',
    salaryType: 'paystub',
    splitRatio: 0.5,
  },
  {
    id: '3',
    name: 'Руслан',
    companyName: '',
    salaryType: 'remainder',
    splitRatio: 1.0,
  }
];

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
  
  const [totalContractAmount, setTotalContractAmount] = useState<number>(1124.50);
  const [ecbAmount, setEcbAmount] = useState<number>(1903.00);
  const [deductEcb, setDeductEcb] = useState<boolean>(false);
  
  const [payStubs, setPayStubs] = useState<PayStubData[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(DEFAULT_MEMBERS);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showConfig, setShowConfig] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Fetch NBU Exchange Rate ---
  const fetchExchangeRate = async (targetDate: string) => {
    setIsNbuLoading(true);
    setNbuStatus({});
    try {
      // Преобразуем YYYY-MM-DD в YYYYMMDD для NBU Stat API
      const apiDate = targetDate.replace(/-/g, '');
      if (apiDate.length !== 8) throw new Error('Некорректный формат даты');
      
      const response = await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew?valcode=USD&date=${apiDate}&json`);
      if (!response.ok) {
        throw new Error(`Ошибка сети: ${response.status}`);
      }
      
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('Некорректный ответ API НБУ');
      }
      
      const usdItem = data[0];
      if (usdItem && (usdItem.rate !== undefined)) {
        const rate = usdItem.rate;
        setExchangeRate(Number(rate));
        
        // Преобразуем для красивого вывода дату
        const parts = targetDate.split('-');
        const formattedDate = `${parts[2]}.${parts[1]}.${parts[0]}`;
        setNbuStatus({ success: true, message: `Курс USD на ${formattedDate} успешно загружен: ${rate} грн.` });
      } else {
        throw new Error('Курс USD на указанную дату отсутствует в API НБУ');
      }
    } catch (error: any) {
      console.error('NBU API Fetch Error:', error);
      setNbuStatus({ success: false, message: `Не удалось загрузить курс: ${error.message || error}` });
    } finally {
      setIsNbuLoading(false);
    }
  };

  // Fetch rate on date change
  useEffect(() => {
    fetchExchangeRate(date);
  }, [date]);

  // --- File Upload / Drag & Drop Handlers ---
  const handleFiles = async (files: FileList) => {
    const newStubs: PayStubData[] = [];
    const errors: string[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.endsWith('.xlsx')) {
        errors.push(`Файл ${file.name} не является Excel-файлом (.xlsx)`);
        continue;
      }
      try {
        const stubData = await parsePayStubExcel(file);
        newStubs.push(stubData);
      } catch (err: any) {
        errors.push(`Ошибка в файле ${file.name}: ${err.message || err}`);
      }
    }

    if (errors.length > 0) {
      alert(errors.join('\n'));
    }

    if (newStubs.length > 0) {
      setPayStubs((prev) => {
        // Убираем дубликаты по имени компании / сотрудника
        const filtered = prev.filter(
          (old) => !newStubs.some((n) => n.companyName.toUpperCase() === old.companyName.toUpperCase())
        );
        const updated = [...filtered, ...newStubs];
        
        // Автоматически добавляем участников из новых файлов, если их имени нет в списке
        setTeamMembers((prevMembers) => {
          const membersCopy = [...prevMembers];
          newStubs.forEach((stub) => {
            const exists = membersCopy.some(
              (m) => m.companyName.toUpperCase() === stub.companyName.toUpperCase()
            );
            if (!exists) {
              membersCopy.push({
                id: String(Date.now() + Math.random()),
                name: stub.agentName,
                companyName: stub.companyName,
                salaryType: 'paystub',
                splitRatio: 0.5,
              });
            }
          });
          return membersCopy;
        });

        return updated;
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
    setPayStubs((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Member CRUD Handlers ---
  const addMember = () => {
    setTeamMembers((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        name: 'Новый сотрудник',
        companyName: '',
        salaryType: 'paystub',
        splitRatio: 0.5,
      }
    ]);
  };

  const updateMember = (id: string, fields: Partial<TeamMember>) => {
    setTeamMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...fields } : m)));
  };

  const deleteMember = (id: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.id !== id));
  };

  // --- Salary Calculations ---
  // Pass 1: Get Gross Salaries for non-remainder members
  const memberIntermediateCalculations = teamMembers.map((member) => {
    let payStubRemaining = 0;
    let grossUSD = 0;
    let matchedStubFile = '';

    if (member.salaryType === 'paystub') {
      const matchedStub = payStubs.find(
        (stub) => stub.companyName.trim().toUpperCase() === member.companyName.trim().toUpperCase()
      );
      if (matchedStub) {
        payStubRemaining = matchedStub.remainingPay;
        grossUSD = payStubRemaining * member.splitRatio;
        matchedStubFile = matchedStub.fileName;
      }
    } else if (member.salaryType === 'fixed') {
      grossUSD = member.fixedAmount || 0;
    }

    return {
      ...member,
      payStubRemaining,
      grossUSD,
      matchedStubFile
    };
  });

  const sumNonRemainderGross = memberIntermediateCalculations
    .filter((m) => m.salaryType !== 'remainder')
    .reduce((sum, m) => sum + m.grossUSD, 0);

  const remainderPool = Math.max(0, totalContractAmount - sumNonRemainderGross);
  const remainderCount = teamMembers.filter((m) => m.salaryType === 'remainder').length;
  const remainderGrossPerMember = remainderCount > 0 ? remainderPool / remainderCount : 0;

  // Pass 2: Final Calculation for all members
  const calculatedMembers = memberIntermediateCalculations.map((m) => {
    const grossUSD = m.salaryType === 'remainder' ? remainderGrossPerMember : m.grossUSD;
    const tax5 = grossUSD * 0.05;
    const tax1 = grossUSD * 0.01;
    const netUSD = grossUSD - (tax5 + tax1);
    const netUAH = netUSD * exchangeRate;
    const ecbUAH = deductEcb ? (ecbAmount / teamMembers.length) : 0;
    const toCardUAH = netUAH - ecbUAH;

    return {
      ...m,
      grossUSD,
      tax5,
      tax1,
      netUSD,
      netUAH,
      ecbUAH,
      toCardUAH
    };
  });

  // Column Totals
  const totalPaystubRemaining = calculatedMembers.reduce((sum, m) => sum + m.payStubRemaining, 0);
  const totalGrossUSD = calculatedMembers.reduce((sum, m) => sum + m.grossUSD, 0);
  const totalTax5 = calculatedMembers.reduce((sum, m) => sum + m.tax5, 0);
  const totalTax1 = calculatedMembers.reduce((sum, m) => sum + m.tax1, 0);
  const totalNetUSD = calculatedMembers.reduce((sum, m) => sum + m.netUSD, 0);
  const totalNetUAH = calculatedMembers.reduce((sum, m) => sum + m.netUAH, 0);
  const totalEcbUAH = calculatedMembers.reduce((sum, m) => sum + m.ecbUAH, 0);
  const totalToCardUAH = calculatedMembers.reduce((sum, m) => sum + m.toCardUAH, 0);

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
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            onClick={() => setShowConfig(!showConfig)}
            className={`btn btn-secondary`}
          >
            <Settings size={18} />
            {showConfig ? 'Скрыть настройки' : 'Настройка участников'}
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
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
                    Будет вычтено по <b>{formatCurrency(ecbAmount / teamMembers.length, true)} грн.</b> на человека ({teamMembers.length} уч.)
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
                accept=".xlsx"
                style={{ display: 'none' }}
              />
              <div className="dropzone-icon">
                <UploadCloud size={28} />
              </div>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                  Перетащите сюда файлы PayStub (.xlsx) или нажмите для выбора
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Users size={20} style={{ color: 'var(--secondary)' }} />
                  Управление Участниками Расчета
                </h2>
                <button onClick={addMember} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                  <Plus size={14} /> Добавить
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {teamMembers.map((member) => (
                  <div 
                    key={member.id} 
                    style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '1fr 1fr 1fr auto', 
                      gap: '1rem', 
                      alignItems: 'end',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '1rem',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.05)'
                    }}
                  >
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
                        onChange={(e) => updateMember(member.id, { salaryType: e.target.value as any })}
                        className="input-control"
                        style={{ padding: '0.5rem 0.75rem', fontSize: '0.9rem', background: '#0b0c16' }}
                      >
                        <option value="paystub">По файлу Paystub</option>
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
                            value={member.splitRatio} 
                            onChange={(e) => updateMember(member.id, { splitRatio: parseFloat(e.target.value) || 0 })}
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
                        Получит остаток от суммы контракта
                      </div>
                    )}

                    <button 
                      onClick={() => deleteMember(member.id)}
                      className="btn btn-danger"
                      style={{ padding: '0.5rem', borderRadius: '8px' }}
                      title="Удалить сотрудника"
                    >
                      <Trash2 size={16} />
                    </button>
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
                    <th>Чистыми ($)</th>
                    <th>Чистыми (грн)</th>
                    <th>Вычет ЕСВ (грн)</th>
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
                        {/* Чистыми ($) */}
                        <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          ${formatCurrency(member.netUSD)}
                        </td>
                        {/* Чистыми (грн) */}
                        <td style={{ fontWeight: 500, color: 'var(--secondary)' }}>
                          {formatCurrency(member.netUAH, true)} ₴
                        </td>
                        {/* Вычет ЕСВ (грн) */}
                        <td style={{ color: member.ecbUAH > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {member.ecbUAH > 0 ? `-${formatCurrency(member.ecbUAH, true)} ₴` : '0.00 ₴'}
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
                    <td>${formatCurrency(totalNetUSD)}</td>
                    <td>{formatCurrency(totalNetUAH, true)} ₴</td>
                    <td>{totalEcbUAH > 0 ? `-${formatCurrency(totalEcbUAH, true)} ₴` : '0.00 ₴'}</td>
                    <td style={{ fontSize: '1.15rem', textShadow: '0 0 10px rgba(0, 230, 118, 0.2)' }}>
                      {formatCurrency(totalToCardUAH, true)} ₴
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Calculations logic description helper */}
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)', marginTop: '1.5rem' }}>
              <HelpCircle size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                <b>Формулы расчета:</b><br />
                • Грязная зп (Gross) для файлов = <code>REMAINING PAY * Доля (обычно 0.5)</code>.<br />
                • Налог = <code>Gross * 5%</code>. Военный сбор = <code>Gross * 1%</code>.<br />
                • Чистыми (USD) = <code>Gross - Налоги (6%)</code>. Чистыми (грн) = <code>Чистыми (USD) * Курс НБУ ({exchangeRate})</code>.<br />
                • При включенном ЕСВ вычитается ровно <code>{formatCurrency(ecbAmount, true)} ₴ / {teamMembers.length} чел. = {formatCurrency(ecbAmount / teamMembers.length, true)} ₴</code> из выплаты каждого участника.
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
