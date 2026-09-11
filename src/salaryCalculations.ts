export interface TeamMember {
  id: string;
  name: string;
  companyName: string;
  sourceFileName?: string;
  salaryType: 'paystub' | 'remainder' | 'fixed';
  fixedAmount?: number;
}

export interface PayStubAmount {
  fileName: string;
  remainingPay: number;
}

export interface SalaryCalculationInput {
  teamMembers: TeamMember[];
  payStubs: PayStubAmount[];
  totalContractAmount: number;
  exchangeRate: number;
  ecbAmount: number;
  deductEcb: boolean;
}

export interface CalculatedMember extends TeamMember {
  splitRatio: number;
  payStubRemaining: number;
  grossUSD: number;
  matchedStubFile: string;
  tax5: number;
  tax1: number;
  netUSD: number;
  netUAH: number;
  ecbUAH: number;
  toCardUAH: number;
}

export interface SalaryCalculationResult {
  memberCount: number;
  splitParticipantCount: number;
  payStubSplitRatio: number;
  ecbPerMember: number;
  sumNonRemainderGross: number;
  remainderPool: number;
  remainderCount: number;
  remainderGrossPerMember: number;
  calculatedMembers: CalculatedMember[];
}

export const calculateSalaries = ({
  teamMembers,
  payStubs,
  totalContractAmount,
  exchangeRate,
  ecbAmount,
  deductEcb,
}: SalaryCalculationInput): SalaryCalculationResult => {
  const memberCount = teamMembers.length;
  const splitParticipantCount = teamMembers.filter(
    (member) => member.salaryType !== 'fixed'
  ).length;
  const payStubSplitRatio = splitParticipantCount > 0 ? 1 / splitParticipantCount : 0;
  const ecbPerMember = memberCount > 0 ? ecbAmount / memberCount : 0;

  const memberIntermediateCalculations = teamMembers.map((member) => {
    let payStubRemaining = 0;
    let grossUSD = 0;
    let matchedStubFile = '';

    if (member.salaryType === 'paystub') {
      const matchedStub = payStubs.find((stub) => stub.fileName === member.sourceFileName);
      if (matchedStub) {
        payStubRemaining = matchedStub.remainingPay;
        grossUSD = payStubRemaining * payStubSplitRatio;
        matchedStubFile = matchedStub.fileName;
      }
    } else if (member.salaryType === 'fixed') {
      grossUSD = member.fixedAmount || 0;
    }

    return {
      ...member,
      splitRatio: member.salaryType === 'paystub' ? payStubSplitRatio : 0,
      payStubRemaining,
      grossUSD,
      matchedStubFile,
    };
  });

  const sumNonRemainderGross = memberIntermediateCalculations
    .filter((member) => member.salaryType !== 'remainder')
    .reduce((sum, member) => sum + member.grossUSD, 0);

  const remainderPool = totalContractAmount - sumNonRemainderGross;
  const remainderCount = teamMembers.filter(
    (member) => member.salaryType === 'remainder'
  ).length;
  const remainderGrossPerMember = remainderCount > 0 ? remainderPool / remainderCount : 0;

  const calculatedMembers = memberIntermediateCalculations.map((member) => {
    const grossUSD = member.salaryType === 'remainder'
      ? remainderGrossPerMember
      : member.grossUSD;
    const tax5 = grossUSD * 0.05;
    const tax1 = grossUSD * 0.01;
    const netUSD = grossUSD - (tax5 + tax1);
    const netUAH = netUSD * exchangeRate;
    const ecbUAH = deductEcb ? ecbPerMember : 0;
    const toCardUAH = netUAH - ecbUAH;

    return {
      ...member,
      grossUSD,
      tax5,
      tax1,
      netUSD,
      netUAH,
      ecbUAH,
      toCardUAH,
    };
  });

  return {
    memberCount,
    splitParticipantCount,
    payStubSplitRatio,
    ecbPerMember,
    sumNonRemainderGross,
    remainderPool,
    remainderCount,
    remainderGrossPerMember,
    calculatedMembers,
  };
};
