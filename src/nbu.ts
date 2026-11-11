/** Курс USD от НБУ на дату YYYY-MM-DD. */
export const fetchNbuRate = async (targetDate: string): Promise<number> => {
  const apiDate = targetDate.replace(/-/g, '');
  if (apiDate.length !== 8) throw new Error('Некорректный формат даты');

  const response = await fetch(
    `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew?valcode=USD&date=${apiDate}&json`
  );
  if (!response.ok) throw new Error(`Ошибка сети: ${response.status}`);

  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('Некорректный ответ API НБУ');

  const rate = Number((data[0] as { rate?: unknown } | undefined)?.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Курс USD на указанную дату отсутствует в API НБУ');
  }
  return rate;
};
