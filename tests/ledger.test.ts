import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyChange,
  buildAccruals,
  computeBalances,
  defaultPeriodForDate,
  emptyLedger,
  nextPartForPeriod,
  normalizeLedger,
  summarizePeriods,
  type Transfer,
} from '../src/ledger.ts';
import { calculateSalaries } from '../src/salaryCalculations.ts';

const member = (name: string, grossUSD: number, taxed = true, ecbUAH = 0) => ({
  name,
  grossUSD,
  tax5: taxed ? grossUSD * 0.05 : 0,
  tax1: taxed ? grossUSD * 0.01 : 0,
  netUSD: taxed ? grossUSD * 0.94 : grossUSD,
  ecbUAH,
});

const transfer = (id: string, person: string, amountUSD: number, rate = 42): Transfer => ({
  id, date: '2026-11-20', person, amountUSD, rate, amountUAH: amountUSD * rate, note: '',
});

test('период по умолчанию — предыдущий месяц', () => {
  assert.equal(defaultPeriodForDate('2026-11-11'), '2026-10');
  assert.equal(defaultPeriodForDate('2027-01-05'), '2026-12');
});

test('две части за один месяц складываются, переводы уменьшают остаток', () => {
  let data = emptyLedger();

  const part1 = buildAccruals({
    members: [member('Игорь', 1000), member('Друг', 500)],
    date: '2026-11-05', period: '2026-10', part: nextPartForPeriod(data.accruals, '2026-10'), rate: 42,
  });
  data = applyChange(data, { accruals: part1 });
  assert.equal(nextPartForPeriod(data.accruals, '2026-10'), 2);

  const part2 = buildAccruals({
    members: [member('Игорь', 600), member('Друг', 300)],
    date: '2026-11-20', period: '2026-10', part: 2, rate: 43,
  });
  data = applyChange(data, { accruals: part2 });
  data = applyChange(data, { transfers: [transfer('t1', 'Друг', 400), transfer('t2', 'Игорь', 100)] });

  const balances = computeBalances(data, 40);
  const igor = balances.find((b) => b.person === 'Игорь')!;
  const friend = balances.find((b) => b.person === 'Друг')!;

  assert.equal(igor.accruedUSD, 1504);
  assert.equal(igor.balanceUSD, 1404);
  assert.equal(friend.accruedUSD, 752);
  assert.equal(friend.transferredUSD, 400);
  assert.equal(friend.transferredUAH, 16800);
  assert.equal(friend.balanceUSD, 352);
  assert.equal(friend.balanceUAH, 14080);

  const [october] = summarizePeriods(data);
  assert.deepEqual(october.parts, [1, 2]);
  assert.equal(october.byPerson['Друг'], 752);
  assert.equal(october.totalUSD, 2256);
});

test('без галочки налогов на баланс идёт грязная сумма', () => {
  const [accrual] = buildAccruals({
    members: [member('Игорь', 1000, false)],
    date: '2026-11-05', period: '2026-10', part: 1, rate: 42,
  });
  assert.equal(accrual.taxUSD, 0);
  assert.equal(accrual.netUSD, 1000);
});

test('ЕСВ вычитается из баланса по курсу платежа', () => {
  const [accrual] = buildAccruals({
    members: [member('Игорь', 1000, true, 840)],
    date: '2026-11-05', period: '2026-10', part: 1, rate: 42,
  });
  assert.equal(accrual.netUSD, 920);
  assert.equal(accrual.netUAH, 38640);
});

test('deductTaxes=false отключает налоги в расчёте', () => {
  const result = calculateSalaries({
    teamMembers: [{ id: 'a', name: 'A', companyName: '', salaryType: 'fixed', fixedAmount: 100 }],
    payStubs: [], totalContractAmount: 100, exchangeRate: 40, ecbAmount: 0, deductEcb: false,
    deductTaxes: false,
  });
  assert.equal(result.calculatedMembers[0].tax5, 0);
  assert.equal(result.calculatedMembers[0].netUSD, 100);
});

test('удаление по id и нормализация данных из таблицы', () => {
  const data = applyChange(
    { accruals: [], transfers: [transfer('t1', 'Друг', 10), transfer('t2', 'Друг', 20)] },
    { deleteIds: ['t1'] }
  );
  assert.deepEqual(data.transfers.map((t) => t.id), ['t2']);

  const normalized = normalizeLedger({
    accruals: [{ id: 'a1', date: '2026-11-05', period: '2026-10', part: '2', person: ' Друг ', netUSD: '94,5' }, { id: '' }],
    transfers: 'мусор',
  });
  assert.equal(normalized.accruals.length, 1);
  assert.equal(normalized.accruals[0].part, 2);
  assert.equal(normalized.accruals[0].person, 'Друг');
  assert.equal(normalized.accruals[0].netUSD, 94.5);
  assert.deepEqual(normalized.transfers, []);
});
