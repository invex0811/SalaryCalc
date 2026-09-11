import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateSalaries,
  type SalaryCalculationInput,
  type TeamMember,
} from '../src/salaryCalculations.ts';

const paystubMember = (id: string, fileName: string): TeamMember => ({
  id,
  name: id,
  companyName: id,
  sourceFileName: fileName,
  salaryType: 'paystub',
});

const remainderMember = (id: string): TeamMember => ({
  id,
  name: id,
  companyName: '',
  salaryType: 'remainder',
});

const calculate = (
  overrides: Partial<SalaryCalculationInput>
): ReturnType<typeof calculateSalaries> => calculateSalaries({
  teamMembers: [],
  payStubs: [],
  totalContractAmount: 0,
  exchangeRate: 44.55,
  ecbAmount: 1903,
  deductEcb: false,
  ...overrides,
});

const assertClose = (actual: number, expected: number): void => {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be close to ${expected}`
  );
};

test('splits one PayStub with one remainder participant', () => {
  const result = calculate({
    teamMembers: [paystubMember('paystub', 'paystub.xlsx'), remainderMember('remainder')],
    payStubs: [{ fileName: 'paystub.xlsx', remainingPay: 826 }],
    totalContractAmount: 731,
  });

  assert.equal(result.splitParticipantCount, 2);
  assert.equal(result.payStubSplitRatio, 0.5);
  assert.equal(result.remainderPool, 318);
  assert.equal(result.calculatedMembers[0].grossUSD, 413);
  assert.equal(result.calculatedMembers[1].grossUSD, 318);
  assertClose(result.calculatedMembers[0].netUSD, 388.22);
  assertClose(result.calculatedMembers[1].netUSD, 298.92);
  assertClose(result.calculatedMembers[0].netUAH, 17295.201);
  assertClose(result.calculatedMembers[1].netUAH, 13316.886);
});

test('splits PayStub amounts between two PayStub participants', () => {
  const result = calculate({
    teamMembers: [
      paystubMember('first', 'first.xlsx'),
      paystubMember('second', 'second.xlsx'),
    ],
    payStubs: [
      { fileName: 'first.xlsx', remainingPay: 826 },
      { fileName: 'second.xlsx', remainingPay: 600 },
    ],
    totalContractAmount: 713,
  });

  assert.equal(result.splitParticipantCount, 2);
  assert.equal(result.payStubSplitRatio, 0.5);
  assert.equal(result.calculatedMembers[0].grossUSD, 413);
  assert.equal(result.calculatedMembers[1].grossUSD, 300);
});

test('includes a remainder participant in a three-way PayStub split', () => {
  const result = calculate({
    teamMembers: [
      paystubMember('first', 'first.xlsx'),
      paystubMember('second', 'second.xlsx'),
      remainderMember('remainder'),
    ],
    payStubs: [
      { fileName: 'first.xlsx', remainingPay: 600 },
      { fileName: 'second.xlsx', remainingPay: 300 },
    ],
    totalContractAmount: 900,
  });

  assert.equal(result.splitParticipantCount, 3);
  assertClose(result.payStubSplitRatio, 1 / 3);
  assert.equal(result.calculatedMembers[0].grossUSD, 200);
  assert.equal(result.calculatedMembers[1].grossUSD, 100);
  assert.equal(result.calculatedMembers[2].grossUSD, 600);
});

test('excludes fixed participants from the PayStub split and subtracts fixed gross from remainder', () => {
  const fixedMember: TeamMember = {
    id: 'fixed',
    name: 'fixed',
    companyName: '',
    salaryType: 'fixed',
    fixedAmount: 100,
  };
  const result = calculate({
    teamMembers: [
      paystubMember('paystub', 'paystub.xlsx'),
      remainderMember('remainder'),
      fixedMember,
    ],
    payStubs: [{ fileName: 'paystub.xlsx', remainingPay: 826 }],
    totalContractAmount: 831,
  });

  assert.equal(result.splitParticipantCount, 2);
  assert.equal(result.payStubSplitRatio, 0.5);
  assert.equal(result.calculatedMembers[0].grossUSD, 413);
  assert.equal(result.calculatedMembers[1].grossUSD, 318);
  assert.equal(result.calculatedMembers[2].grossUSD, 100);
});

test('keeps distributed gross equal to the contract and does not hide a negative remainder', () => {
  const result = calculate({
    teamMembers: [paystubMember('paystub', 'paystub.xlsx'), remainderMember('remainder')],
    payStubs: [{ fileName: 'paystub.xlsx', remainingPay: 900 }],
    totalContractAmount: 400,
  });

  assert.equal(result.remainderPool, -50);
  assert.equal(result.calculatedMembers[1].grossUSD, -50);
  assert.equal(
    result.calculatedMembers.reduce((sum, member) => sum + member.grossUSD, 0),
    400
  );
});
