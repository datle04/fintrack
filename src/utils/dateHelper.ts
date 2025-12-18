export const getEndOfDay = (dateString: string) => {
    const date = new Date(dateString);
    date.setUTCHours(23, 59, 59, 999);
    return date;
}

export const getStartOfDay = (dateString: string) => {
    const date = new Date(dateString);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

export const getStartOfMonth = (year: number, month: number) => {
    return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

export const getEndOfMonth = (year: number, month: number) => {
  const lastDay = new Date(Date.UTC(year, month, 0));
  return getEndOfDay(lastDay.toISOString());
};