/**
 * SalaryCalc — хранилище учёта в Google Таблице.
 *
 * Установка (один раз):
 *  1. Создайте Google Таблицу → Расширения → Apps Script.
 *  2. Вставьте этот файл целиком вместо содержимого Code.gs.
 *  3. Придумайте свой секретный ключ и впишите его в SECRET ниже.
 *  4. Начать развертывание → Новое развертывание → тип «Веб-приложение»:
 *       Запуск от имени: «От моего имени», Доступ: «Все».
 *  5. Скопируйте URL веб-приложения (заканчивается на /exec) и вставьте его
 *     вместе с ключом на сайте в блоке «Google Таблица».
 *
 * Листы «Начисления», «Переводы» и «Баланс» скрипт создаёт сам.
 */

const SECRET = 'ЗАМЕНИТЕ_НА_СВОЙ_КЛЮЧ';

const TABLES = {
  accruals: {
    sheet: 'Начисления',
    fields: ['id', 'date', 'period', 'part', 'person', 'grossUSD', 'taxUSD', 'ecbUAH', 'netUSD', 'rate', 'netUAH', 'note'],
    headers: ['ID', 'Дата платежа', 'За месяц', 'Часть', 'Участник', 'Грязными $', 'Налоги $', 'ЕСВ грн', 'На баланс $', 'Курс', 'На баланс грн', 'Комментарий'],
    text: ['id', 'date', 'period', 'person', 'note'],
  },
  transfers: {
    sheet: 'Переводы',
    fields: ['id', 'date', 'person', 'amountUSD', 'rate', 'amountUAH', 'note'],
    headers: ['ID', 'Дата', 'Участник', 'Сумма $', 'Курс', 'Сумма грн', 'Комментарий'],
    text: ['id', 'date', 'person', 'note'],
  },
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const request = JSON.parse(e.postData.contents);
    if (SECRET === 'ЗАМЕНИТЕ_НА_СВОЙ_КЛЮЧ') throw new Error('В скрипте не задан секретный ключ (SECRET)');
    if (request.key !== SECRET) throw new Error('Неверный секретный ключ');

    lock.waitLock(20000);
    if (request.action === 'apply') {
      applyChange(request);
    } else if (request.action !== 'list') {
      throw new Error('Неизвестное действие: ' + request.action);
    }
    return respond({ ok: true, data: readAll() });
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) { /* блокировка не была взята */ }
  }
}

function doGet() {
  return respond({ ok: true, message: 'SalaryCalc: скрипт работает. Данные доступны только с секретным ключом.' });
}

function respond(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet(table) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(table.sheet);
  if (!sheet) {
    sheet = book.insertSheet(table.sheet);
    sheet.getRange(1, 1, 1, table.headers.length).setValues([table.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Текстовые колонки, чтобы Таблица не превращала «2026-10» в дату.
    table.text.forEach(function (field) {
      sheet.getRange(1, table.fields.indexOf(field) + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sheet;
}

function cellToValue(value, field) {
  if (value instanceof Date) {
    const zone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, zone, field === 'period' ? 'yyyy-MM' : 'yyyy-MM-dd');
  }
  return value;
}

function readTable(table) {
  const sheet = getSheet(table);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, table.fields.length)
    .getValues()
    .filter(function (row) { return String(row[0]) !== ''; })
    .map(function (row) {
      const record = {};
      table.fields.forEach(function (field, index) { record[field] = cellToValue(row[index], field); });
      return record;
    });
}

function readAll() {
  return { accruals: readTable(TABLES.accruals), transfers: readTable(TABLES.transfers) };
}

function deleteRows(table, ids) {
  if (!ids || ids.length === 0) return;
  const sheet = getSheet(table);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const column = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = column.length - 1; i >= 0; i--) {
    if (ids.indexOf(String(column[i][0])) !== -1) sheet.deleteRow(i + 2);
  }
}

function appendRows(table, records) {
  if (!records || records.length === 0) return;
  const sheet = getSheet(table);
  const rows = records.map(function (record) {
    return table.fields.map(function (field) {
      const value = record[field];
      return value === undefined || value === null ? '' : value;
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, table.fields.length).setValues(rows);
}

function applyChange(request) {
  deleteRows(TABLES.accruals, request.deleteIds);
  deleteRows(TABLES.transfers, request.deleteIds);
  appendRows(TABLES.accruals, request.accruals);
  appendRows(TABLES.transfers, request.transfers);
  SpreadsheetApp.flush();
  writeBalanceSheet();
}

/** Лист «Баланс»: сводка остатков, чтобы её было видно прямо в таблице. */
function writeBalanceSheet() {
  const data = readAll();
  const totals = {};
  const person = function (name) {
    if (!totals[name]) totals[name] = { accrued: 0, usd: 0, uah: 0 };
    return totals[name];
  };
  data.accruals.forEach(function (a) { person(a.person).accrued += Number(a.netUSD) || 0; });
  data.transfers.forEach(function (t) {
    person(t.person).usd += Number(t.amountUSD) || 0;
    person(t.person).uah += Number(t.amountUAH) || 0;
  });

  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName('Баланс') || book.insertSheet('Баланс', 0);
  const rows = [['Участник', 'Начислено $', 'Переведено $', 'Переведено грн', 'Остаток $']];
  Object.keys(totals).forEach(function (name) {
    const t = totals[name];
    rows.push([name, round2(t.accrued), round2(t.usd), round2(t.uah), round2(t.accrued - t.usd)]);
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
