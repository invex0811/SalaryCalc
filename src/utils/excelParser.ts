import * as XLSX from 'xlsx';

export interface PayStubData {
  agentName: string;
  companyName: string;
  remainingPay: number;
  fileName: string;
}

export const parsePayStubExcel = (file: File): Promise<PayStubData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          throw new Error('Не удалось прочитать содержимое файла');
        }
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Преобразуем лист во временную двумерную матрицу
        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
        
        let agentName = '';
        let companyName = '';
        let remainingPay = 0;
        
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          
          for (let i = 0; i < row.length; i++) {
            const val = row[i];
            if (typeof val === 'string') {
              const label = val.trim().toUpperCase();
              if (label === 'AGENT NAME:' && i + 1 < row.length) {
                agentName = String(row[i + 1]).trim();
              } else if (label === 'COMPANY NAME:' && i + 1 < row.length) {
                companyName = String(row[i + 1]).trim();
              } else if (label === 'REMAINING PAY:' && i + 1 < row.length) {
                const payVal = row[i + 1];
                if (typeof payVal === 'number') {
                  remainingPay = payVal;
                } else if (payVal !== null && payVal !== undefined) {
                  // Очищаем от знака доллара, пробелов, запятых и конвертируем
                  const cleanStr = String(payVal).replace(/[^0-9.-]/g, '');
                  remainingPay = parseFloat(cleanStr) || 0;
                }
              }
            }
          }
        }
        
        if (!companyName) {
          throw new Error('В файле не найдена строка COMPANY NAME:');
        }
        
        resolve({
          agentName: agentName || companyName,
          companyName,
          remainingPay,
          fileName: file.name,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsArrayBuffer(file);
  });
};
